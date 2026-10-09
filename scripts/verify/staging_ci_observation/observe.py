#!/usr/bin/env python3
"""Fixed, read-only CI observation. No migration CLI or arbitrary SQL input."""
import argparse
import ctypes
import ctypes.util
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import parse_qs, unquote, urlsplit

PROJECT = 'lbeqxarxothkmzqvpudy'
SQL_SHA256 = 'ba366062942c37a380664d82b5987323ca80bdbfe53470a10a3230d55600140e'
SQL_FILE = Path(__file__).with_name('snapshot.sql')

class ObservationError(Exception):
    pass

def ci_context(env):
    required = {'GITHUB_ACTIONS': 'true', 'GITHUB_REF': 'refs/heads/main',
                'GITHUB_EVENT_NAME': 'workflow_dispatch',
                'GITHUB_REPOSITORY': 'byite-co/ssambership_web'}
    if any(env.get(k) != v for k, v in required.items()):
        raise ObservationError('CI_CONTEXT_REJECTED')
    if not re.fullmatch(r'[0-9a-f]{40}', env.get('GITHUB_SHA', '')):
        raise ObservationError('CI_SOURCE_SHA_MISSING')
    if not all(re.fullmatch(r'[0-9]+',env.get(k,'')) for k in ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT')):
        raise ObservationError('CI_RUN_ID_MISSING')
    return {k:env.get(k) for k in (*required, 'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_WORKFLOW_REF', 'GITHUB_WORKFLOW_SHA')}

def check_target(url):
    # Inspect only in memory. Do not emit URL/host/user/password or URI options.
    # Unrecognized aliases/custom proxies require a reviewed collector change.
    try:
        parts = urlsplit(url)
        query = parse_qs(parts.query, keep_blank_values=True)
        if parts.scheme not in ('postgres', 'postgresql') or parts.fragment:
            raise ValueError()
        if set(query) & {'host','hostaddr','port','user','password','dbname','service','servicefile'}:
            raise ValueError()
        host = parts.hostname or ''
        username = unquote(parts.username or '')
        if host == f'db.{PROJECT}.supabase.co':
            mode = 'standard_direct_endpoint'
        elif host.endswith('.pooler.supabase.com') and username.endswith('.'+PROJECT):
            mode = 'standard_project_pooler_endpoint'
        else:
            raise ValueError()
        if parts.port not in (None,5432,6543) or parts.path not in ('','/postgres'):
            raise ValueError()
        markers = [url]
        if parts.password:
            markers.extend([parts.password, unquote(parts.password)])
        return mode, markers
    except (ValueError, TypeError):
        raise ObservationError('TARGET_URL_UNRECOGNIZED') from None

def libpq_environment(url):
    """Use libpq's own URI parser, then its declared environment variable names.

    PGDATABASE alone does not expand an environment-supplied connection URI.
    Passwords remain only in memory/child environment, never files or argv.
    Refuse options with no environment representation rather than drop them.
    """
    class Option(ctypes.Structure):
        _fields_=[(name,ctypes.c_char_p) for name in
            ('keyword','envvar','compiled','val','label','dispchar')]+[('dispsize',ctypes.c_int)]
    name=ctypes.util.find_library('pq')
    if not name:
        raise ObservationError('LIBPQ_PARSER_UNAVAILABLE')
    lib=ctypes.CDLL(name)
    lib.PQconninfoParse.argtypes=[ctypes.c_char_p,ctypes.POINTER(ctypes.c_char_p)]
    lib.PQconninfoParse.restype=ctypes.POINTER(Option)
    lib.PQconninfoFree.argtypes=[ctypes.POINTER(Option)]
    lib.PQconninfoFree.restype=None
    lib.PQfreemem.argtypes=[ctypes.c_void_p]
    lib.PQfreemem.restype=None
    lib.PQlibVersion.restype=ctypes.c_int
    error=ctypes.c_char_p();options=lib.PQconninfoParse(url.encode(),ctypes.byref(error))
    try:
        if not options:
            raise ObservationError('LIBPQ_URI_REJECTED')
        env={};i=0
        while options[i].keyword is not None:
            opt=options[i]
            if opt.val is not None:
                if opt.envvar is None:
                    raise ObservationError('URI_OPTION_NOT_ENV_REPRESENTABLE')
                env[opt.envvar.decode()]=opt.val.decode()
            i+=1
        return env,lib.PQlibVersion()
    finally:
        if options:lib.PQconninfoFree(options)
        if error.value is not None:lib.PQfreemem(ctypes.cast(error,ctypes.c_void_p))

def sensitive_json(value,markers):
    if isinstance(value,str):return any(marker in value for marker in markers)
    if isinstance(value,list):return any(sensitive_json(v,markers) for v in value)
    if isinstance(value,dict):return any(sensitive_json(k,markers) or sensitive_json(v,markers) for k,v in value.items())
    return False

def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    path.chmod(0o600)

def collect(output, env, run=subprocess.run):
    # This callable enables local fake-client tests. The CLI always enforces CI
    # context; tests never supply the real Environment secret.
    output.mkdir(parents=True, exist_ok=False)
    output.chmod(0o700)
    manifest = {'status':'NOT_COLLECTED', 'HOLD':True, 'authorizes_apply':False,
        'started_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'environment':'supabase-db-adoption','secret_name':'SUPABASE_DB_URL',
        'expected_project_ref':PROJECT,'db_client_invocations':0,
        'migration_tool_executed':False,'set_role_issued':False,
        'full_catalog_collected':False,'final_after_drain_snapshot':False}
    exit_code = 1
    try:
        manifest['ci'] = ci_context(env)
        raw_sql = SQL_FILE.read_bytes()
        if hashlib.sha256(raw_sql).hexdigest() != SQL_SHA256:
            raise ObservationError('COLLECTOR_SQL_HASH_MISMATCH')
        manifest['sql_sha256'] = SQL_SHA256
        manifest['collector_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        url = env.get('SUPABASE_DB_URL')
        if not url:
            raise ObservationError('ENVIRONMENT_SECRET_MISSING')
        mode, markers = check_target(url)
        manifest['endpoint_check'] = mode
        # Interpret the exact URI with libpq; never put it on argv. Avoid
        # unrelated PG*/service-file defaults inherited from the CI process.
        parsed,libpq_version=libpq_environment(url)
        child = {k:env[k] for k in ('PATH','LANG','LC_ALL','TZ') if k in env}
        child.update(PGCONNECT_TIMEOUT='10',PGOPTIONS='-c default_transaction_read_only=on')
        child.update(parsed)
        manifest['probe_only_overrides'] = {'PGCONNECT_TIMEOUT':'10',
            'PGOPTIONS':'-c default_transaction_read_only=on',
            'sql_transaction':'READ ONLY / REPEATABLE READ; ROLLBACK',
            'defaults_only_when_uri_omits_these_options':True,
            'uri_semantics_preserved_by_native_libpq_parser':True,
            'explicit_uri_options_win_over_probe_defaults':True}
        manifest['libpq_parser_version']=libpq_version
        manifest['client'] = run(['psql','--version'],capture_output=True,text=True,
                                timeout=10,check=True,env={k:v for k,v in child.items() if not k.startswith('PG')}).stdout.strip()
        version=re.search(r'PostgreSQL\) (\d+)\.',manifest['client'])
        if not version or int(version.group(1))!=libpq_version//10000:
            raise ObservationError('LIBPQ_PSQL_MAJOR_MISMATCH')
        command = ['psql','-X','-qAt','--no-password','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate']
        manifest['db_client_invocations'] = 1
        result = run(command, input=raw_sql.decode(),capture_output=True,text=True,
                     timeout=60,env=child)
        manifest['psql_exit_code'] = result.returncode
        manifest['stderr_bytes'] = len(result.stderr.encode())
        # Do not persist/print raw stderr, including connection errors, notices,
        # TimeoutExpired output, URL, libpq options or any credentials.
        states = re.findall(r'\b(?:ERROR|FATAL):\s+([0-9A-Z]{5})\b',result.stderr)
        manifest['error_sqlstates'] = sorted(set(states))
        if result.returncode:
            raise ObservationError('PSQL_OBSERVATION_FAILED')
        if any(marker in result.stdout for marker in markers):
            raise ObservationError('SENSITIVE_OUTPUT_REJECTED')
        try:
            snapshot = json.loads(result.stdout)
        except (json.JSONDecodeError, TypeError):
            raise ObservationError('OBSERVATION_JSON_INVALID') from None
        if sensitive_json(snapshot,markers):
            raise ObservationError('SENSITIVE_OUTPUT_REJECTED')
        if not isinstance(snapshot,dict) or snapshot.get('read_only')!='on' or snapshot.get('isolation')!='repeatable read':
            raise ObservationError('READONLY_TRANSACTION_NOT_PROVEN')
        fields = ('session_user','current_user','session_preload_libraries',
                  'supautils_policy_grants','supautils_privileged_role','role',
                  'storage_native_privileges','migration_history','server_version_num','ssl')
        if any(k not in snapshot for k in fields):
            raise ObservationError('OBSERVATION_FIELDS_MISSING')
        if not snapshot['session_user'] or not snapshot['current_user']:
            raise ObservationError('OBSERVATION_ROLE_MISSING')
        write_json(output/'snapshot.json', snapshot)
        manifest.update(status='OBSERVED_READ_ONLY',exit_code=0,
            snapshot_sha256=hashlib.sha256((output/'snapshot.json').read_bytes()).hexdigest(),
            unknown_settings=[k for k in ('session_preload_libraries','supautils_policy_grants','supautils_privileged_role') if snapshot[k] is None],
            tls_observed=snapshot['ssl'],
            migration_execution_identity_proven=False,
            limitations=['Same Environment/secret using psql; not a Supabase CLI execution trace.',
                        'Native privilege results do not establish Supautils policy/lock authority.',
                        'Null means unobserved, not empty or disabled. No HOLD is released.'])
        exit_code = 0
    except ObservationError as error:
        manifest['error_code'] = error.args[0]
    except subprocess.TimeoutExpired:
        manifest['error_code'] = 'PSQL_TIMEOUT'
    except (OSError, subprocess.CalledProcessError):
        manifest['error_code'] = 'PSQL_CLIENT_UNAVAILABLE'
    except Exception:
        manifest['error_code'] = 'OBSERVATION_INTERNAL_ERROR'
    finally:
        manifest['exit_code'] = exit_code
        write_json(output/'manifest.json',manifest)
        files=sorted(p for p in output.iterdir() if p.is_file())
        (output/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in files))
    return exit_code

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    try:
        code=collect(args.output,os.environ)
    except OSError:
        print('OBSERVATION_OUTPUT_UNAVAILABLE', file=sys.stderr)
        return 1
    print('OBSERVATION_COLLECTED_HOLD_RETAINED' if code==0 else 'OBSERVATION_FAILED_HOLD_RETAINED')
    return code

if __name__=='__main__':
    raise SystemExit(main())
