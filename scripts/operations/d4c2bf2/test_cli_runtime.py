#!/usr/bin/env python3
"""Exact executor dry-run/PTY driver + real pinned CLI, local fixture SQL only.

Two pre-created empty local databases: rc_executor_cli_success/failure. Does not
run the financial candidate or claim Hosted permission/acceptance proof.
"""
import importlib.util, os, pathlib, tempfile

root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('cli_executor',root/'run.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
env={k:v for k,v in os.environ.items() if not k.startswith(('PG','SUPABASE','CODEX_','CLAUDE','CURSOR'))}
env.update(PGHOST='/dbsocket',PGPORT='55476',PGUSER='postgres',PGCONNECT_TIMEOUT='3',LC_ALL='C',LANG='C',TERM='xterm-256color',SUPABASE_NO_KEYRING='1',SUPABASE_TELEMETRY_DISABLED='1')
with tempfile.TemporaryDirectory(prefix='cli-runtime-') as temp:
    temp=pathlib.Path(temp);m.PUBLIC=temp/'evidence';env['SUPABASE_HOME']=str(temp/'cli-state')
    for fail in [False,True]:
        db='rc_executor_cli_failure' if fail else 'rc_executor_cli_success'
        env['PGDATABASE']=db
        assert m.psql('SELECT current_database();',env)==[db]
        assert m.psql("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');",env)==['0']
        project=temp/db;(project/'supabase/migrations').mkdir(parents=True)
        (project/'supabase/config.toml').write_text('project_id = "local-cli-only"\n')
        body='CREATE TABLE public.executor_fixture(id int PRIMARY KEY);\n'
        if fail:body+='SELECT 1/0;\n'
        (project/'supabase/migrations'/m.FILENAME).write_text(body)
        uri='postgresql://postgres@localhost:55476/'+db+'?host=/dbsocket&sslmode=disable'
        m.SUMMARY.update(attempted_apply=False,apply_invocations=0)
        m.dry_run(project,uri,env)
        code,accepted=m.apply_once(project,uri,env)
        assert accepted
        assert (code!=0) is fail
        exists=m.psql("SELECT to_regclass('public.executor_fixture') IS NOT NULL;",env)
        ledger=m.psql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='"+m.VERSION+"';",env)
        assert exists==(['f'] if fail else ['t'])
        assert ledger==(['0'] if fail else ['1'])
        try:m.apply_once(project,uri,env)
        except m.Refuse as e:assert str(e)=='SECOND_APPLY_FORBIDDEN'
        else:raise AssertionError('SECOND_APPLY_NOT_BLOCKED')
        print('PASS real CLI '+('body-failure rollback' if fail else 'success and history')+'; second apply refused',flush=True)
print('PASS 2 real CLI fixture scenarios; no financial migration or Hosted access')
