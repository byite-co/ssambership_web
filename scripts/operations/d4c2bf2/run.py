#!/usr/bin/env python3
"""Fixed candidate executor. Local draft; publication/dispatch require separate scope.

No SQL/connection/ref input, no repair/recovery mode, no raw DB output upload.
The only maintenance writes are stopping/restoring the two recorded cron jobs.
"""
import ctypes as C
import hashlib, json, os, pathlib, pty, re, select, shutil, subprocess, sys, time

ROOT=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'lib'))
import collect_readiness_snapshot, exact_objects
VERSION='20261009070000'
FILENAME=VERSION+'_staging_integration.sql'
CLI_SHA='f038518c4a116c343249f29669df5a13adc27626c89b14f4187779b5bbd1629c'
SQL_SHA='aebdf9702f7750fdbea0cdc72c8bced99ad69917d5b2a4a689a4eaa42a3d6be1'
JOBS=['nice_auth_token_sweep_daily','subscription_settlement_refresh_hourly']
PSQL='/usr/bin/psql'
LIBPQ='/usr/lib/x86_64-linux-gnu/libpq.so.5'
CLI=pathlib.Path('/tools/supabase')
WORK=pathlib.Path('/work')
PUBLIC=pathlib.Path('/evidence')
SUMMARY={'candidate':'d4c2bf28755169e79a5fd2891537a8734dbf08f6','tree':'5b43ef77e4de8b8dfb3f38a405799cebabd338ca',
         'attempted_apply':False,'apply_invocations':0,'schema_state':'NOT_OBSERVED','cron_changed':False,
         'customer_activation':'HOLD','repair_executed':False,'compensation_executed':False,'events':[]}

class Refuse(Exception): pass
def require(ok,code):
    if not ok: raise Refuse(code)
def sha(data): return hashlib.sha256(data).hexdigest()
def event(code,**data):
    SUMMARY['events'].append({'code':code,**data})
    PUBLIC.mkdir(parents=True,exist_ok=True)
    (PUBLIC/'result.json').write_text(json.dumps(SUMMARY,indent=2)+'\n')
    print(json.dumps({'event':code,**data}),flush=True)

def verify_files():
    manifest=ROOT/'manifest.json'
    require(sha(manifest.read_bytes())==os.environ.get('EXPECTED_MANIFEST_SHA256'),'MANIFEST_HASH_MISMATCH')
    m=json.loads(manifest.read_text())
    for name,digest in m['files'].items():
        p=ROOT/name
        require(p.resolve().is_relative_to(ROOT.resolve()) and p.is_file() and sha(p.read_bytes())==digest,'FILE_HASH_MISMATCH')
    project=ROOT/'payload/first-apply-project'
    files=sorted((project/'supabase/migrations').glob('*.sql'))
    require(len(files)==128 and files[-1].name==FILENAME,'INITIAL_PACK_MISMATCH')
    require(not (project/'supabase/.env').exists(),'PROJECT_ENV_NOT_ALLOWED')
    require(sha(files[-1].read_bytes())==SQL_SHA,'APPLY_SQL_HASH_MISMATCH')
    require(all(x.name[:14] not in ['20261009070100','20261009070200','20261009010000'] for x in files),'RECOVERY_IN_INITIAL_PACK')
    require(CLI.is_file() and sha(CLI.read_bytes())==CLI_SHA,'CLI_BINARY_MISMATCH')
    event('FILES_VERIFIED',historical_files=127,initial_pending=FILENAME)
    destination=WORK/'first-apply-project'
    shutil.copytree(project,destination)
    destination.chmod(0o700)
    for directory in destination.rglob('*'):
        if directory.is_dir():directory.chmod(0o700)
    for p in project.rglob('*'):
        if p.is_file():require(p.read_bytes()==(destination/p.relative_to(project)).read_bytes(),'WORKDIR_COPY_MISMATCH')
    return destination

class PQOption(C.Structure):
    _fields_=[(x,C.c_char_p) for x in ['keyword','envvar','compiled','val','label','dispchar']]+[('dispsize',C.c_int)]

def connection_environment():
    value=os.environ.get('SUPABASE_DB_URL','')
    require(bool(value),'DB_BINDING_MISSING')
    # Do not silently accept a different destination, service file, role option or TLS downgrade.
    pq=C.CDLL(LIBPQ)
    pq.PQlibVersion.restype=C.c_int
    require(pq.PQlibVersion()==180006,'LIBPQ_VERSION_MISMATCH')
    pq.PQconninfoParse.argtypes=[C.c_char_p,C.POINTER(C.c_void_p)];pq.PQconninfoParse.restype=C.POINTER(PQOption)
    pq.PQconninfoFree.argtypes=[C.POINTER(PQOption)];pq.PQfreemem.argtypes=[C.c_void_p]
    err=C.c_void_p();p=pq.PQconninfoParse(value.encode(),C.byref(err))
    if not p:
        if err.value:pq.PQfreemem(err)
        raise Refuse('INVALID_DB_URI')
    cfg={};pg={};i=0
    try:
        while p[i].keyword:
            if p[i].val is not None:
                k=p[i].keyword.decode();v=p[i].val.decode();cfg[k]=v
                if p[i].envvar:pg[p[i].envvar.decode()]=v
            i+=1
    finally:pq.PQconninfoFree(p)
    require(cfg.get('host') in ['aws-0-ap-northeast-2.pooler.supabase.com','aws-1-ap-northeast-2.pooler.supabase.com'] and cfg.get('user')=='postgres.lbeqxarxothkmzqvpudy' and cfg.get('port')=='5432' and cfg.get('dbname')=='postgres','TARGET_PROJECT_MISMATCH')
    require(not any(cfg.get(x) for x in ['service','hostaddr','options']),'UNREVIEWED_CONNECTION_OVERRIDE')
    require(cfg.get('sslmode') in ['require','verify-ca','verify-full'],'EXPLICIT_TLS_REQUIRED')
    env={k:v for k,v in os.environ.items() if not k.startswith(('PG','SUPABASE','CODEX_','CLAUDE','CURSOR','GEMINI','COPILOT_','OPENCODE','REPL_','ANTIGRAVITY','AUGMENT'))}
    env.update(pg);env.update(PGCONNECT_TIMEOUT='10',PGAPPNAME='d4c2bf2-cloud-preflight',SUPABASE_HOME='/work/cli-state',SUPABASE_TELEMETRY_DISABLED='1',SUPABASE_NO_KEYRING='1',TERM='xterm-256color',LC_ALL='C',LANG='C')
    return value,env

def psql(sql,env,readonly=True):
    if readonly:sql='BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'+sql+'\nROLLBACK;'
    proc=subprocess.run([PSQL,'-X','-qAt','-w','-v','ON_ERROR_STOP=1'],input=sql.encode(),capture_output=True,env=env,timeout=180)
    require(proc.returncode==0,'READONLY_SQL_FAILED' if readonly else 'MAINTENANCE_SQL_FAILED')
    return proc.stdout.decode().splitlines()

def snapshot(env,label):
    rows=psql(collect_readiness_snapshot.sql(),env,readonly=False)
    require(len(rows)==3,'SNAPSHOT_INCOMPLETE')
    core,expanded,platform=map(json.loads,rows)
    require(platform['read_only']=='on' and platform['isolation']=='repeatable read','SNAPSHOT_NOT_READONLY')
    # Full results remain on the ephemeral runner; only hashes/counts are published.
    dst=WORK/label;dst.mkdir(mode=0o700)
    for name,data in zip(['core','expanded','platform'],[core,expanded,platform]):
        encoded=json.dumps(data,ensure_ascii=False).encode();(dst/(name+'.json')).write_bytes(encoded)
        event('SNAPSHOT_HASH',stage=label,section=name,sha256=sha(encoded))
    return core,platform

DRAIN="""SELECT json_build_object(
 'busy',(SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid() AND usename IN ('authenticator','postgres','anon','authenticated','service_role') AND (state<>'idle' OR xact_start IS NOT NULL)),
 'other_postgres',(SELECT count(*) FROM pg_stat_activity WHERE usename='postgres' AND pid<>pg_backend_pid()),
 'pending_paysync',(SELECT count(*) FROM public.paysync_invoices WHERE status='pending'),
 'pending_payments',(SELECT count(*) FROM public.payments WHERE status IN ('pending','processing')),
 'outbox_leased',(SELECT count(*) FROM public.notification_outbox WHERE status='leased' OR leased_until>now()),
 'deletion_leased',(SELECT count(*) FROM public.account_deletion_jobs WHERE leased_until>now()),
 'cron_running',(SELECT count(*) FROM cron.job_run_details WHERE status='running'),
 'cron',(SELECT json_agg(json_build_object('id',jobid,'name',jobname,'active',active,'owner',username) ORDER BY jobname) FROM cron.job),
 'fingerprint',json_build_object(
  'objects',(SELECT json_build_array(count(*),max(created_at),max(updated_at)) FROM storage.objects),
  'multipart',(SELECT count(*) FROM storage.s3_multipart_uploads),
  'outbox',(SELECT json_agg(t ORDER BY status) FROM (SELECT status,count(*) FROM public.notification_outbox GROUP BY status) t),
  'paysync',(SELECT json_agg(t ORDER BY status) FROM (SELECT status,count(*) FROM public.paysync_invoices GROUP BY status) t),
  'cash',(SELECT json_build_array(count(*),max(created_at)) FROM public.cash_ledger),
  'users',(SELECT json_build_array(count(*),max(created_at)) FROM public.users),
  'deletion',(SELECT count(*) FROM public.account_deletion_jobs))
);"""

def check_drain(data,cron_active):
    for key in ['busy','other_postgres','pending_paysync','pending_payments','outbox_leased','deletion_leased','cron_running']:
        require(data[key]==0,'ACTIVE_WORK_'+key.upper())
    require([x['name'] for x in data['cron']]==JOBS,'CRON_INVENTORY_MISMATCH')
    require(all(x['owner']=='postgres' and x['active'] is cron_active for x in data['cron']),'CRON_STATE_MISMATCH')

def drain(env,cron_active):
    data=json.loads(psql(DRAIN,env)[0]);check_drain(data,cron_active)
    event('DRAIN_CLEAR',cron_active=cron_active,fingerprint_sha256=sha(json.dumps(data['fingerprint'],sort_keys=True).encode()))
    return data

def cron(env,active):
    flag='true' if active else 'false'
    # Fixed inventory/owner validated immediately before this transaction; no unschedule or role changes.
    sql="BEGIN; SET LOCAL lock_timeout='4s'; SELECT cron.alter_job(jobid,active := "+flag+") FROM cron.job WHERE jobname IN ('nice_auth_token_sweep_daily','subscription_settlement_refresh_hourly') AND username='postgres'; COMMIT;"
    rows=psql(sql,env,readonly=False);require(len(rows)==2,'CRON_CHANGE_COUNT_MISMATCH')
    SUMMARY['cron_changed']=not active;event('CRON_RESTORED' if active else 'CRON_STOPPED')

def check_history(platform,count,latest):
    history=platform['migration_history']
    require(len(history)==count and max(x['version'] for x in history)==latest,'HISTORY_MISMATCH')
    versions=[x['version'] for x in history]
    require(not any(x in versions for x in ['20261009070100','20261009070200']),'RECOVERY_HISTORY_PRESENT')
    if count==128:
        rows=[x for x in history if x['version']==VERSION]
        require(len(rows)==1 and rows[0]['name']=='staging_integration' and len(rows[0]['statements'])==213 and rows[0].get('created_by') is None,'APPLIED_HISTORY_ROW_MISMATCH')

def check_context(env):
    out=psql((ROOT/'sql/execution_context_snapshot.sql').read_text(),env,readonly=False)
    require(len(out)==1,'CONTEXT_SNAPSHOT_INCOMPLETE');c=json.loads(out[0])
    require(c['session_user']==c['current_user']=='postgres' and c['role']['superuser'] is False and c['role']['bypass_rls'] is True,'EXECUTOR_IDENTITY_MISMATCH')
    require('supautils' in (c.get('session_preload_libraries') or '')+(c.get('shared_preload_libraries') or ''),'SUPAUTILS_NOT_LOADED')
    require('storage.objects' in json.loads(c['supautils_policy_grants']).get('postgres',[]),'STORAGE_POLICY_GRANT_MISSING')
    result=psql("SELECT NOT pg_has_role(current_user,'supabase_admin','MEMBER'), has_database_privilege(current_user,current_database(),'CREATE');",env)
    require(result==['t|t'],'EXECUTOR_PRIVILEGE_MISMATCH')
    ssl=psql('\\conninfo',env)
    require(any('SSL connection' in x for x in ssl),'CLIENT_TLS_NOT_PROVEN')
    event('CONTEXT_AND_CLIENT_TLS_PASS')

def dry_run(project,uri,env):
    p=subprocess.run([str(CLI),'--agent','no','--output-format','json','db','push','--db-url',uri,'--workdir',str(project),'--dry-run'],env=env,capture_output=True,timeout=120)
    require(p.returncode==0,'CLI_DRY_RUN_FAILED')
    try:data=json.loads(p.stdout)
    except Exception:raise Refuse('CLI_DRY_RUN_NOT_JSON') from None
    require(data.get('dryRun') is True and data.get('upToDate') is False and data.get('migrations')==[FILENAME] and data.get('seeds')==[] and data.get('roles')==[],'CLI_PENDING_NOT_EXACTLY_070000')
    event('CLI_DRY_RUN_EXACTLY_ONE')

def prompt_ready(raw):
    text=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',raw.decode(errors='replace'))
    files=set(re.findall(r'\b\d{14}_[A-Za-z0-9_]+\.sql\b',text))
    if 'Applying migration' in text:return 'unexpected-apply'
    if 'Do you want to push these migrations' in text and 'Yes' in text and 'No' in text:
        return 'accept' if files=={FILENAME} else 'reject'
    return 'wait'

def apply_once(project,uri,env):
    require(SUMMARY['apply_invocations']==0,'SECOND_APPLY_FORBIDDEN')
    SUMMARY.update(attempted_apply=True,apply_invocations=1,schema_state='APPLY_RESULT_NOT_YET_KNOWN')
    event('APPLY_STARTING_ONCE')
    pid,fd=pty.fork()
    if pid==0:
        os.execve(str(CLI),[str(CLI),'--agent','no','db','push','--db-url',uri,'--workdir',str(project)],env)
    buffer=b'';accepted=False;started=time.monotonic();code=None;last_monitor=started;cancel_sent=False
    try:
        while True:
            ready,_,_=select.select([fd],[],[],1)
            if ready:
                try:chunk=os.read(fd,65536)
                except OSError:chunk=b''
                if chunk:buffer=(buffer+chunk)[-2_000_000:]
            if not accepted and not cancel_sent:
                decision=prompt_ready(buffer)
                if decision=='accept':os.write(fd,b'\r');accepted=True;event('EXACT_CLI_PROMPT_ACCEPTED')
                elif decision in ['reject','unexpected-apply']:
                    os.write(fd,b'\x03');cancel_sent=True;event('UNEXPECTED_CLI_MODE_CANCEL_SENT')
            if time.monotonic()-started>60 and not accepted and not cancel_sent:
                os.write(fd,b'\x03');cancel_sent=True
            if accepted and not cancel_sent and time.monotonic()-last_monitor>=5:
                last_monitor=time.monotonic()
                try:
                    waits=psql("SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND usename='postgres' AND wait_event_type='Lock' AND now()-xact_start>interval '60 seconds';",env)
                    if waits!=['0']:
                        os.write(fd,b'\x03');cancel_sent=True;event('LOCK_WAIT_CANCEL_SENT_TO_OWN_CLI')
                except Exception:
                    os.write(fd,b'\x03');cancel_sent=True;event('MONITOR_FAILURE_CANCEL_SENT_TO_OWN_CLI')
            child,status=os.waitpid(pid,os.WNOHANG)
            if child:
                code=os.waitstatus_to_exitcode(status);break
            if time.monotonic()-started>600:
                os.write(fd,b'\x03');raise Refuse('CLI_TIMEOUT_STATE_UNKNOWN')
    finally:os.close(fd)
    # Full CLI errors can echo function bodies/URLs; only an error code and output digest leave the runner.
    codes=re.findall(rb'SQLSTATE\s+([0-9A-Z]{5})',buffer)
    event('CLI_RETURNED',exit_code=code,output_sha256=sha(buffer),sqlstate=codes[-1].decode() if codes else None,prompt_accepted=accepted)
    return code,accepted

def postcheck(env,baseline,expected,historical):
    core,platform=snapshot(env,'post-apply')
    require(exact_objects.keyed(core)==exact_objects.keyed(expected),'POST_CATALOG_MISMATCH')
    check_history(platform,128,VERSION)
    require([r for r in platform['migration_history'] if r['version']!=VERSION]==historical,'HISTORICAL_LEDGER_CHANGED')
    state=psql((ROOT/'sql/release_state.sql').read_text(),env,readonly=False)
    require(len(state)==3 and state[0]=='t' and state[1].split('|')[:9]==['t',VERSION,'2','170006','290','99','89','98','t'] and state[2]=='t|postgres|f|f|f','RELEASE_STATE_MISMATCH')
    saved=json.loads(psql('SELECT baseline_catalog FROM core_private.integration_release_state;',env)[0])
    require(saved==baseline,'RECORDED_BASELINE_MISMATCH')
    rpc=psql((ROOT/'sql/rpc_check.sql').read_text(),env,readonly=False)
    require(len(rpc)==72 and all(x.endswith('|t') for x in rpc),'RPC_CONTRACT_MISMATCH')
    # Policy and every ACL are included in the exact catalog check above.
    psql((ROOT/'sql/policy_check.sql').read_text(),env,readonly=False)
    SUMMARY['schema_state']='APPLIED_AND_VERIFIED'
    event('POSTCHECK_PASS',history_rows=128,rpc_contract_rows=72)

def main():
    require(os.environ.get('GITHUB_EVENT_NAME')=='workflow_dispatch' and os.environ.get('GITHUB_REF')=='refs/heads/main' and os.environ.get('GITHUB_REPOSITORY')=='byite-co/ssambership_web' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','WORKFLOW_CONTEXT_REJECTED')
    project=verify_files();uri,env=connection_environment()
    v=subprocess.run([str(CLI),'--version'],capture_output=True,env=env,timeout=20)
    require(v.returncode==0 and v.stdout.strip()==b'2.111.0','CLI_VERSION_MISMATCH')
    v=subprocess.run([PSQL,'--version'],capture_output=True,env=env,timeout=20)
    require(v.returncode==0 and v.stdout.startswith(b'psql (PostgreSQL) 18.6 '),'PSQL_VERSION_MISMATCH')
    check_context(env)
    baseline=json.loads((ROOT/'payload/baseline-catalog.json').read_text())
    expected=json.loads((ROOT/'payload/candidate-catalog.json').read_text())
    current,platform=snapshot(env,'pre-maintenance')
    require(current==baseline,'PRE_CATALOG_DRIFT');check_history(platform,127,'20261008021536')
    historical=platform['migration_history']
    SUMMARY['schema_state']='BASELINE_VERIFIED'
    initial=drain(env,True)
    dry_run(project,uri,env)
    cron(env,False)
    try:
        first=drain(env,False)
        for _ in range(10):time.sleep(30);event('DRAIN_WAIT_PROGRESS')
        second=drain(env,False)
        require(first['fingerprint']==second['fingerprint'],'DRAIN_CHANGED')
        final,final_platform=snapshot(env,'final-before-apply')
        require(final==baseline,'FINAL_CATALOG_DRIFT');check_history(final_platform,127,'20261008021536')
        require(final_platform['migration_history']==platform['migration_history'],'FINAL_LEDGER_CHANGED')
        dry_run(project,uri,env)
        code,accepted=apply_once(project,uri,env)
        if code==0 and accepted:
            postcheck(env,baseline,expected,historical)
            require(json.loads(psql(DRAIN,env)[0])['pending_paysync']==0,'POST_PENDING_PAYMENT_REVIEW_REQUIRED')
            cron(env,True)
            event('COMPLETE',customer_activation='HOLD')
            return
        # No retry or compensation. Only establish committed vs rolled-back status.
        core,platform=snapshot(env,'after-cli-error')
        if exact_objects.keyed(core)==exact_objects.keyed(expected) and len(platform['migration_history'])==128:
            postcheck(env,baseline,expected,historical)
            event('COMMIT_CONFIRMED_AFTER_CLI_ERROR_CRON_REMAINS_STOPPED')
        elif core==baseline and len(platform['migration_history'])==127:
            check_history(platform,127,'20261008021536')
            require(platform['migration_history']==historical,'ROLLBACK_LEDGER_MISMATCH')
            SUMMARY['schema_state']='ROLLED_BACK_VERIFIED'
            cron(env,True)
            event('ROLLBACK_VERIFIED_NO_RETRY')
        else:SUMMARY['schema_state']='UNKNOWN_REQUIRES_READONLY_RECONCILIATION'
        raise Refuse('CLI_DID_NOT_COMPLETE_NORMALLY')
    except Exception:
        if not SUMMARY['attempted_apply'] and SUMMARY['cron_changed']:
            try:
                unchanged,unchanged_platform=snapshot(env,'maintenance-abort')
                require(unchanged==baseline,'MAINTENANCE_ABORT_CATALOG_DRIFT')
                check_history(unchanged_platform,127,'20261008021536')
                require(unchanged_platform['migration_history']==historical,'MAINTENANCE_ABORT_LEDGER_DRIFT')
                cron(env,True)
            except Exception:
                event('MAINTENANCE_RESTORE_NOT_PROVEN_CRON_REMAINS_STOPPED')
        # Do not make assumptions about a cancelled/failed job or restore writers over an unknown result.
        event('STOPPED',schema_state=SUMMARY['schema_state'],cron_requires_attention=SUMMARY['cron_changed'])
        raise

if __name__=='__main__':
    try:main()
    except Refuse as e:event('REFUSED',reason=str(e));raise SystemExit(1)
    except Exception as e:event('FAILED',error_type=type(e).__name__);raise SystemExit(1)
