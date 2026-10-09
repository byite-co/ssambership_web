#!/usr/bin/env python3
"""Collect a preliminary catalog in one READ ONLY, REPEATABLE READ transaction.

Remote connections use libpq PG* environment/service configuration, never a URL
in argv. This script performs no RPC, DDL, business read, ledger repair or apply.
Output is private operational evidence, not a deployment authorization.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

import catalog_contract


def sql():
    # Keep the release comparator's exact scope and bytes. The second export is
    # additive platform evidence, not a replacement or relaxed baseline.
    core = catalog_contract.query().removesuffix("COMMIT;\n")
    old = catalog_contract.SCHEMAS, catalog_contract.FUNCTION_SCHEMAS
    scope = "SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'"
    try:
        catalog_contract.SCHEMAS = catalog_contract.FUNCTION_SCHEMAS = scope
        expanded = catalog_contract.query()
    finally:
        catalog_contract.SCHEMAS, catalog_contract.FUNCTION_SCHEMAS = old
    expanded = expanded[expanded.index("SELECT jsonb_build_object("):].removesuffix("COMMIT;\n")
    expanded = expanded.replace("AND p.prokind='f'", "AND p.prokind IN ('f','p','w')")
    expanded = expanded.replace(" AND NOT t.tgisinternal", "")
    platform = """
SELECT jsonb_build_object(
 'observed_at_utc',clock_timestamp(),
 'database',current_database(),'session_user',session_user,'current_user',current_user,
 'read_only',current_setting('transaction_read_only'),
 'isolation',current_setting('transaction_isolation'),
 'server_version',version(),
 'transaction_snapshot',pg_current_snapshot()::text,
 'migration_history',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY version),'[]'::jsonb)
   FROM supabase_migrations.schema_migrations m),
 'extensions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,
   'schema',n.nspname,'owner',pg_get_userbyid(e.extowner)) ORDER BY e.extname),'[]'::jsonb)
   FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'inherit',rolinherit,
   'create_role',rolcreaterole,'create_db',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,
   'bypass_rls',rolbypassrls) ORDER BY rolname) FROM pg_roles),
 'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),
   'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,
   'inherit',inherit_option,'set',set_option) ORDER BY roleid,member),'[]'::jsonb) FROM pg_auth_members),
 'postgrest_session_settings',jsonb_build_object(
   'db_schemas',current_setting('pgrst.db_schemas',true),
   'db_extra_search_path',current_setting('pgrst.db_extra_search_path',true),
   'db_pre_request',current_setting('pgrst.db_pre_request',true),
   'db_max_rows',current_setting('pgrst.db_max_rows',true)),
 'postgrest_role_database_settings',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'database',CASE WHEN s.setdatabase=0 THEN '*' ELSE d.datname END,
   'role',CASE WHEN s.setrole=0 THEN '*' ELSE pg_get_userbyid(s.setrole) END,'setting',cfg)
   ORDER BY s.setdatabase,s.setrole,cfg),'[]'::jsonb)
   FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid=s.setdatabase
   CROSS JOIN LATERAL unnest(s.setconfig) cfg
   WHERE split_part(cfg,'=',1) IN ('pgrst.db_schemas','pgrst.db_extra_search_path','pgrst.db_pre_request','pgrst.db_max_rows','pgrst.db_anon_role')),
 'storage_buckets',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,
   'name',to_jsonb(b)->'name','public',to_jsonb(b)->'public',
   'file_size_limit',to_jsonb(b)->'file_size_limit','allowed_mime_types',to_jsonb(b)->'allowed_mime_types')
   ORDER BY b.id),'[]'::jsonb) FROM storage.buckets b),
 'enum_domain_types',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',t.typname,
   'kind',t.typtype,'owner',pg_get_userbyid(t.typowner),'acl',t.typacl::text,
   'base',format_type(t.typbasetype,t.typtypmod),'not_null',t.typnotnull,'default',t.typdefault,
   'labels',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid))
   ORDER BY n.nspname,t.typname),'[]'::jsonb) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
   WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND t.typtype IN ('e','d')),
 'limitations',jsonb_build_array(
   'SQL settings do not prove the running PostgREST process configuration; require control-plane export and live API probes.',
   'No Auth users, Storage object names, tokens, credentials or business data are exported.',
   'Preliminary snapshot only. Recollect after write stop and drain for the actual release boundary.')
);
ROLLBACK;
"""
    return core + expanded + platform


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--container', help='Local disposable Docker target only')
    parser.add_argument('--database', help='Required with --container; otherwise use libpq configuration')
    parser.add_argument('--emit-only', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    args.output.chmod(0o700)
    query = sql()
    (args.output / 'snapshot.sql').write_bytes(query.encode())
    if args.emit_only:
        return
    if args.container:
        if not args.database or not re.fullmatch(r'[A-Za-z0-9_.-]+', args.container + args.database):
            parser.error('invalid local target')
        command = ['docker','exec','-i',args.container,'psql','-U','postgres','-d',args.database]
    else:
        if args.database or not (os.environ.get('PGSERVICE') or os.environ.get('PGHOST')):
            parser.error('provide libpq PGSERVICE/PGHOST configuration; database URLs are not accepted')
        command = ['psql']
    command += ['-X','-qAt','-v','ON_ERROR_STOP=1']
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    result = subprocess.run(command,input=query.encode(),capture_output=True,timeout=240)
    (args.output/'psql.stdout').write_bytes(result.stdout)
    (args.output/'psql.stderr').write_bytes(result.stderr)
    summary = {'started_at_utc':started,'exit_code':result.returncode,'scope':'preliminary_read_only',
               'remote_apply_authorized':False,'collector_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    if result.returncode == 0:
        documents = [json.loads(line) for line in result.stdout.decode().splitlines() if line.strip()]
        if len(documents) != 3:
            raise RuntimeError('SNAPSHOT_INCOMPLETE: expected core, expanded and platform exports')
        if documents[2]['read_only'] != 'on' or documents[2]['isolation'] != 'repeatable read':
            raise RuntimeError('SNAPSHOT_TRANSACTION_CONTRACT_INVALID')
        for name, value in zip(('core-catalog','expanded-catalog','platform'),documents):
            (args.output/(name+'.json')).write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
        summary['migration_count'] = len(documents[2]['migration_history'])
        summary['observed_at_utc'] = documents[2]['observed_at_utc']
    summary['files'] = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(args.output.iterdir()) if p.is_file()}
    (args.output/'manifest.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps({k:v for k,v in summary.items() if k!='files'}))
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
