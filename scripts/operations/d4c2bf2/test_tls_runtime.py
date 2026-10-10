#!/usr/bin/env python3
"""Real parser/client TLS tests against loopback protocol stubs, never a DB."""
import contextlib, importlib.util, json, os, pathlib, socket, ssl, struct, subprocess, tempfile, threading
from unittest.mock import patch

root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('executor_tls_test',root/'run.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
dummy='postgresql://postgres.lbeqxarxothkmzqvpudy:dummy%40pass@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?application_name=fixture%20only'

# The job's real libpq parser and environment path; PQconnect is never called.
with patch.dict(os.environ,{'SUPABASE_DB_URL':dummy,'PGSSLMODE':'disable'},clear=False),patch.object(m.subprocess,'run',side_effect=AssertionError('UNEXPECTED_PROCESS')):
    effective,env=m.connection_environment()
    assert effective==dummy+'&sslmode=require'
    assert env['PGSSLMODE']=='require' and env['PGPASSWORD']=='dummy@pass'
    assert os.environ['SUPABASE_DB_URL']==dummy
for query in ['sslmode=disable','sslmode=prefer','sslmode=allow','sslmode=']:
    with patch.dict(os.environ,{'SUPABASE_DB_URL':dummy+'&'+query},clear=False),patch.object(m.subprocess,'run',side_effect=AssertionError('UNEXPECTED_PROCESS')):
        try:m.connection_environment()
        except m.Refuse:pass
        else:raise AssertionError('WEAK_TLS_ACCEPTED')

def exact(sock,size):
    result=b''
    while len(result)<size:
        part=sock.recv(size-len(result))
        if not part:break
        result+=part
    return result

with tempfile.TemporaryDirectory(prefix='executor-tls-') as name:
    temp=pathlib.Path(name);key=temp/'key.pem';cert=temp/'cert.pem'
    certgen=subprocess.run(['/usr/bin/openssl','req','-x509','-newkey','rsa:2048','-nodes','-subj','/CN=localhost','-days','1','-keyout',str(key),'-out',str(cert)],capture_output=True,timeout=30)
    assert certgen.returncode==0,'TEST_CERT_GENERATION_FAILED'
    ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(cert,key)
    project=temp/'project';(project/'supabase/migrations').mkdir(parents=True)
    (project/'supabase/config.toml').write_text('project_id = "tls-loopback-fixture"\n')
    results=[]
    for tool in ['psql','supabase']:
        for permit_tls in [True,False]:
            listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen();listener.settimeout(15)
            port=listener.getsockname()[1];observed={'tool':tool,'server_accepts_tls':permit_tls,'ssl_request':False,'tls_established':False,'plaintext_startup':False}
            errors=[]
            def serve():
                try:
                    with listener:
                        sock,_=listener.accept();sock.settimeout(10)
                        with sock:
                            request=exact(sock,8);observed['ssl_request']=request==struct.pack('!II',8,80877103)
                            if not observed['ssl_request']:
                                observed['plaintext_startup']=True;return
                            if not permit_tls:
                                sock.sendall(b'N')
                                try:observed['plaintext_startup']=bool(sock.recv(8))
                                except (ConnectionResetError,TimeoutError):pass
                                return
                            sock.sendall(b'S')
                            with ctx.wrap_socket(sock,server_side=True) as secured:
                                observed['tls_established']=True;observed['tls_version']=secured.version()
                                header=exact(secured,4);assert len(header)==4
                                length=struct.unpack('!I',header)[0];assert 8<=length<=10000
                                exact(secured,length-4)
                                body=b'SFATAL\x00C28000\x00MLOCAL_TLS_FIXTURE_STOP\x00\x00'
                                secured.sendall(b'E'+struct.pack('!I',len(body)+4)+body)
                except Exception as e:errors.append(type(e).__name__)
            thread=threading.Thread(target=serve,daemon=True);thread.start()
            # Only this isolated test changes the endpoint to its in-process stub.
            uri=m.require_tls_uri('postgresql://fixture:dummy@127.0.0.1:'+str(port)+'/postgres?connect_timeout=4')
            client_env={k:v for k,v in os.environ.items() if not k.startswith(('PG','SUPABASE'))}
            client_env.update(SUPABASE_HOME=str(temp/'cli-state'),SUPABASE_TELEMETRY_DISABLED='1',SUPABASE_NO_KEYRING='1',LC_ALL='C')
            cmd=[m.PSQL,'-X','-qAt','-w','--dbname',uri,'-c','SELECT 1'] if tool=='psql' else [str(m.CLI),'--agent','no','--output-format','json','db','push','--db-url',uri,'--workdir',str(project),'--dry-run']
            proc=subprocess.run(cmd,capture_output=True,env=client_env,timeout=25);thread.join(timeout=12)
            assert not thread.is_alive() and not errors,('STUB_FAILED',errors)
            assert proc.returncode!=0 and observed['ssl_request'] and not observed['plaintext_startup'],observed
            assert observed['tls_established'] is permit_tls,observed
            if permit_tls:assert b'LOCAL_TLS_FIXTURE_STOP' in proc.stdout+proc.stderr,'WRONG_STOP_REASON'
            observed['exit_code']=proc.returncode;observed['expected_failure']=True;results.append(observed)
    metadata_results=[]
    for encrypted in [True,False]:
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen();listener.settimeout(15)
        port=listener.getsockname()[1];errors=[];statements=[]
        def message(kind,payload):return kind+struct.pack('!I',len(payload)+4)+payload
        def serve_metadata():
            try:
                with listener:
                    sock,_=listener.accept();sock.settimeout(10)
                    with sock:
                        first=exact(sock,8)
                        if encrypted:
                            assert first==struct.pack('!II',8,80877103)
                            sock.sendall(b'S');connection=ctx.wrap_socket(sock,server_side=True)
                            header=exact(connection,4);length=struct.unpack('!I',header)[0]
                            assert 8<=length<=10000;exact(connection,length-4)
                        else:
                            connection=sock;length=struct.unpack('!I',first[:4])[0]
                            assert 8<=length<=10000;exact(connection,length-8)
                        with connection:
                            connection.sendall(message(b'R',struct.pack('!I',0)))
                            for key,value in [('server_version','17.6'),('server_encoding','UTF8'),('client_encoding','UTF8'),('DateStyle','ISO, MDY'),('integer_datetimes','on'),('standard_conforming_strings','on'),('is_superuser','off'),('in_hot_standby','off')]:
                                connection.sendall(message(b'S',key.encode()+b'\0'+value.encode()+b'\0'))
                            connection.sendall(message(b'K',struct.pack('!II',12345,67890))+message(b'Z',b'I'))
                            while True:
                                kind=exact(connection,1)
                                if not kind:break
                                header=exact(connection,4);length=struct.unpack('!I',header)[0]
                                assert 4<=length<=10000;payload=exact(connection,length-4)
                                if kind==b'X':break
                                assert kind==b'Q';query=payload.rstrip(b'\0').decode().strip();statements.append(query)
                                assert query in ['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;','ROLLBACK;'],query
                                begin=query.startswith('BEGIN')
                                connection.sendall(message(b'C',b'BEGIN\0' if begin else b'ROLLBACK\0')+message(b'Z',b'T' if begin else b'I'))
            except Exception as e:errors.append(type(e).__name__)
        thread=threading.Thread(target=serve_metadata,daemon=True);thread.start()
        client_env={k:v for k,v in os.environ.items() if not k.startswith(('PG','SUPABASE'))}
        client_env.update(PGHOST='127.0.0.1',PGPORT=str(port),PGUSER='fixture',PGDATABASE='fixture',PGCONNECT_TIMEOUT='4',PGSSLMODE='require' if encrypted else 'disable',LC_ALL='C',LANG='C')
        # Exact production psql flags and READ ONLY/ROLLBACK wrapper.
        rows=m.psql('\\conninfo',client_env);thread.join(timeout=12)
        assert not thread.is_alive() and not errors,('METADATA_STUB_FAILED',errors)
        assert len(statements)==2
        if encrypted:
            assert not any('SSL connection' in row for row in rows),'OLD_FAILURE_NOT_REPRODUCED'
            proof=m.check_client_tls(rows);assert proof['ssl_in_use'] and proof['protocol']=='TLSv1.3'
            metadata_results.append({'encrypted':True,'old_guard_false_negative_reproduced':True,'new_guard':'PASS','protocol':proof['protocol'],'read_only_protocol_statements':2})
        else:
            try:m.check_client_tls(rows)
            except m.Refuse as e:assert str(e)=='CLIENT_TLS_NOT_PROVEN'
            else:raise AssertionError('PLAINTEXT_ACCEPTED')
            metadata_results.append({'encrypted':False,'new_guard':'REFUSED_AS_EXPECTED','read_only_protocol_statements':2})
    print(json.dumps({'real_libpq_environment_path':'PASS','weak_tls_rejected_before_connection':True,'stored_secret_unchanged':True,'cases':results,'actual_psql18_conninfo_cases':metadata_results,'database_sql_executed':0,'hosted_connection_tested':False}))
