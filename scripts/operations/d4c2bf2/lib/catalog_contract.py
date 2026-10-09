#!/usr/bin/env python3
"""Read-only catalog export and exact comparison, including pg_default_acl.

An exported snapshot is evidence, never migration approval. This utility does
not connect to remote databases or accept replacement hashes. SQL has no writes.
"""
import argparse
import hashlib
import json
from pathlib import Path


SCHEMAS = "'public','core_private','api_web_v1','api_app_v1','storage'"
FUNCTION_SCHEMAS = "'public','core_private','api_web_v1','api_app_v1'"


def acl(expression, default):
    return f"""jsonb_build_object('is_null',({expression}) IS NULL,'entries',
      (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'grantor',pg_get_userbyid(a.grantor),
        'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
        'privilege',a.privilege_type,'grantable',a.is_grantable)
        ORDER BY pg_get_userbyid(a.grantor),
          CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          a.privilege_type,a.is_grantable),'[]'::jsonb)
       FROM aclexplode(CASE WHEN cardinality(coalesce({expression},{default}))>0
         THEN coalesce({expression},{default}) ELSE NULL::aclitem[] END) a))"""


def query():
    function_acl = acl('p.proacl', "acldefault('f',p.proowner)")
    relation_acl = acl('c.relacl', "acldefault(CASE WHEN c.relkind='S' THEN 'S'::\"char\" ELSE 'r'::\"char\" END,c.relowner)")
    column_acl = acl('a.attacl', "'{}'::aclitem[]")
    default_acl = acl('d.defaclacl', "'{}'::aclitem[]")
    schema_acl = acl('n.nspacl', "acldefault('n',n.nspowner)")
    return f"""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,public;
SET LOCAL TimeZone='UTC';
SET LOCAL DateStyle='ISO,YMD';
SET LOCAL statement_timeout='60s';
SELECT jsonb_build_object(
 'format_version',2,
 'server_version_num',current_setting('server_version_num'),
 'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'identity',p.oid::regprocedure::text,
   'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),
   'acl',{function_acl},'comment',obj_description(p.oid,'pg_proc'),'security_definer',p.prosecdef,'configuration',p.proconfig,
   'execute',jsonb_build_object(
      'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service_role',has_function_privilege('service_role',p.oid,'EXECUTE')))
   ORDER BY n.nspname,p.oid::regprocedure::text),'[]'::jsonb)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ({FUNCTION_SCHEMAS}) AND p.prokind='f'),
 'relations',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'name',c.relname,'kind',c.relkind,
   'owner',pg_get_userbyid(c.relowner),'acl',{relation_acl},
   'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'options',c.reloptions,
   'view_definition',CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,false) END)
   ORDER BY n.nspname,c.relname),'[]'::jsonb)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ({SCHEMAS}) AND c.relkind IN ('r','p','v','m','S')),
 'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'table',c.relname,'name',a.attname,'position',a.attnum,
   'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
   'identity',a.attidentity,'generated',a.attgenerated,
   'default',pg_get_expr(d.adbin,d.adrelid),'acl',{column_acl})
   ORDER BY n.nspname,c.relname,a.attnum),'[]'::jsonb)
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE n.nspname IN ({SCHEMAS}) AND c.relkind IN ('r','p','v','m')
   AND a.attnum>0 AND NOT a.attisdropped),
 'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'table',c.relname,'name',p.polname,'command',p.polcmd,
   'permissive',p.polpermissive,
   'roles',(SELECT jsonb_agg(CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_oid) END
      ORDER BY CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_oid) END)
      FROM unnest(p.polroles) role_oid),
   'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
   ORDER BY n.nspname,c.relname,p.polname),'[]'::jsonb)
   FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ({SCHEMAS})),
 'default_acl',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'owner',pg_get_userbyid(d.defaclrole),'schema',n.nspname,
   'object_type',d.defaclobjtype,'acl',{default_acl})
   ORDER BY pg_get_userbyid(d.defaclrole),coalesce(n.nspname,''),d.defaclobjtype),'[]'::jsonb)
   FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
   WHERE d.defaclnamespace=0 OR n.nspname IN ({SCHEMAS})),
 'schemas',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',{schema_acl})
   ORDER BY n.nspname),'[]'::jsonb) FROM pg_namespace n WHERE n.nspname IN ({SCHEMAS})),
 'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'table',c.relname,'name',k.conname,
   'definition',pg_get_constraintdef(k.oid,false),'validated',k.convalidated)
   ORDER BY n.nspname,c.relname,k.conname),'[]'::jsonb)
   FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ({SCHEMAS})),
 'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'table',c.relname,'name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),
   'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique)
   ORDER BY n.nspname,ic.relname),'[]'::jsonb)
   FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
   JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ({SCHEMAS})),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'table',c.relname,'name',t.tgname,
   'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,false))
   ORDER BY n.nspname,c.relname,t.tgname),'[]'::jsonb)
   FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ({SCHEMAS}) AND NOT t.tgisinternal)
);
COMMIT;
"""


SECTIONS = {'functions', 'relations', 'columns', 'policies', 'default_acl',
            'schemas', 'constraints', 'triggers', 'indexes'}


def compare(expected, actual):
    for snapshot in (expected, actual):
        if set(snapshot) != SECTIONS | {'format_version', 'server_version_num'}:
            raise ValueError('CATALOG_SNAPSHOT_INCOMPLETE')
        if snapshot['format_version'] != 2:
            raise ValueError('CATALOG_SNAPSHOT_VERSION_UNSUPPORTED')
        if any(not isinstance(snapshot[section], list) for section in SECTIONS):
            raise ValueError('CATALOG_SNAPSHOT_SECTION_INVALID')
    # Do not normalize CRLF/ACLs away. Reviewed variants need a separately
    # scoped contract, not a generic option that weakens the full snapshot.
    return sorted(key for key in expected if expected[key] != actual[key])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    emit = sub.add_parser('emit-sql')
    emit.add_argument('--output', type=Path, required=True)
    diff = sub.add_parser('compare')
    diff.add_argument('--expected', type=Path, required=True)
    diff.add_argument('--actual', type=Path, required=True)
    diff.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.action == 'emit-sql':
        args.output.write_bytes(query().encode('utf-8'))
        return
    raw = [p.read_bytes() for p in (args.expected, args.actual)]
    changed = compare(*(json.loads(value) for value in raw))
    report = {'ok': not changed, 'changed_sections': changed,
              'expected_sha256': hashlib.sha256(raw[0]).hexdigest(),
              'actual_sha256': hashlib.sha256(raw[1]).hexdigest(),
              'authorizes_apply': False}
    args.output.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report))
    if changed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
