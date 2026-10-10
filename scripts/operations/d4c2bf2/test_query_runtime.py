#!/usr/bin/env python3
"""Actual executor psql/JSON path against an isolated PostgreSQL fixture.

Requires a local Unix socket mounted at /dbsocket, no remote URL. Fixture only:
this tests result parsing and cron orchestration, not Hosted privileges or
financial migration correctness. The cron function below is a fixture stub.
"""
import importlib.util, json, os, pathlib, tempfile, unittest

root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('query_executor',root/'run.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
env={k:v for k,v in os.environ.items() if not k.startswith(('PG','SUPABASE'))}
env.update(PGHOST='/dbsocket',PGPORT='55476',PGUSER='postgres',PGDATABASE='rc_executor_json',PGCONNECT_TIMEOUT='3',LC_ALL='C',LANG='C')
FIXTURE="""
CREATE SCHEMA storage;
CREATE SCHEMA cron;
CREATE SCHEMA core_private;
CREATE TABLE public.paysync_invoices(status text);
CREATE TABLE public.payments(status text);
CREATE TABLE public.notification_outbox(status text, leased_until timestamptz);
CREATE TABLE public.account_deletion_jobs(leased_until timestamptz);
CREATE TABLE public.cash_ledger(created_at timestamptz);
CREATE TABLE public.users(created_at timestamptz);
CREATE TABLE storage.objects(created_at timestamptz,updated_at timestamptz);
CREATE TABLE storage.s3_multipart_uploads(id int);
CREATE TABLE cron.job_run_details(status text);
CREATE TABLE cron.job(jobid bigint,jobname text,active boolean,username text);
CREATE TABLE core_private.integration_release_state(baseline_catalog jsonb);
INSERT INTO cron.job VALUES
 (1,'nice_auth_token_sweep_daily',true,'postgres'),
 (2,'subscription_settlement_refresh_hourly',true,'postgres');
INSERT INTO notification_outbox VALUES ('sent',NULL),('failed',NULL);
INSERT INTO paysync_invoices VALUES ('paid'),('expired');
CREATE FUNCTION cron.alter_job(job_id bigint, active boolean) RETURNS void LANGUAGE sql
 AS 'UPDATE cron.job SET active=$2 WHERE jobid=$1';
"""

class QueryRuntime(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert m.psql("SELECT current_database(),current_setting('server_version_num');",env)==['rc_executor_json|170006']
        assert m.psql("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');",env)==['0']
        m.psql(FIXTURE,env,readonly=False)
        cls.tmp=tempfile.TemporaryDirectory(prefix='query-runtime-');m.PUBLIC=pathlib.Path(cls.tmp.name)
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def test_01_old_first_line_parser_fails_on_actual_drain(self):
        raw=m.psql_output(m.DRAIN,env)
        self.assertGreater(len(raw.splitlines()),1)
        with self.assertRaises(json.JSONDecodeError):json.loads(raw.splitlines()[0])
        value=json.loads(raw)
        self.assertEqual(len(value['fingerprint']['outbox']),2)
        self.assertEqual(len(value['fingerprint']['paysync']),2)
    def test_02_full_drain_preserves_all_status_counts(self):
        value=m.drain(env,True)
        self.assertEqual(value['fingerprint']['outbox'],[{'status':'failed','count':1},{'status':'sent','count':1}])
        self.assertEqual(value['fingerprint']['paysync'],[{'status':'expired','count':1},{'status':'paid','count':1}])
    def test_03_post_drain_uses_whole_json_too(self):
        value=m.psql_json(m.DRAIN,env,'POST_DRAIN')
        self.assertEqual(value['pending_paysync'],0)
    def test_04_pending_payment_still_blocks(self):
        m.psql("INSERT INTO paysync_invoices VALUES ('pending');",env,readonly=False)
        try:
            with self.assertRaisesRegex(m.Refuse,'ACTIVE_WORK_PENDING_PAYSYNC'):m.drain(env,True)
        finally:m.psql("DELETE FROM paysync_invoices WHERE status='pending';",env,readonly=False)
    def test_05_leased_outbox_still_blocks(self):
        m.psql("INSERT INTO notification_outbox VALUES ('leased',now()+interval '1 minute');",env,readonly=False)
        try:
            with self.assertRaisesRegex(m.Refuse,'ACTIVE_WORK_OUTBOX_LEASED'):m.drain(env,True)
        finally:m.psql("DELETE FROM notification_outbox WHERE status='leased';",env,readonly=False)
    def test_06_two_void_rows_and_cron_stop_restore(self):
        before=m.drain(env,True)['fingerprint']
        m.cron(env,False)
        self.assertTrue(m.SUMMARY['cron_changed'])
        try:self.assertEqual(m.drain(env,False)['fingerprint'],before)
        finally:m.cron(env,True)
        self.assertEqual(m.drain(env,True)['fingerprint'],before)
        self.assertFalse(m.SUMMARY['cron_changed'])
    def test_07_readonly_transaction_really_enforced(self):
        with self.assertRaisesRegex(m.Refuse,'READONLY_SQL_FAILED'):
            m.psql('INSERT INTO payments VALUES (\'pending\');',env)
        self.assertEqual(m.psql('SELECT count(*) FROM payments;',env),['0'])
    def test_08_jsonb_recorded_baseline_is_not_altered(self):
        m.psql('INSERT INTO core_private.integration_release_state VALUES (\'{"functions":[{"definition":"a\\nb"}],"format_version":2}\');',env,readonly=False)
        self.assertEqual(m.psql_json('SELECT baseline_catalog FROM core_private.integration_release_state;',env,'RECORDED_BASELINE'),{'functions':[{'definition':'a\nb'}],'format_version':2})
    def test_09_unicode_separator_and_escaped_newline_preserved(self):
        self.assertEqual(m.psql_json("SELECT json_build_object('text',chr(8232)||chr(10)||chr(8233));",env,'FIXTURE'),{'text':'\u2028\n\u2029'})
    def test_10_multiple_documents_refused(self):
        with self.assertRaisesRegex(m.Refuse,'JSON_RESPONSE_INVALID_FIXTURE'):
            m.psql_json("SELECT '{}'::json; SELECT '{}'::json;",env,'FIXTURE')
    def test_11_empty_or_truncated_document_refused_without_payload(self):
        for query in ["SELECT '{}'::json WHERE false;","SELECT '{\"DO_NOT_LOG_FIXTURE_SECRET\":';"]:
            with self.assertRaises(m.Refuse) as ctx:m.psql_json(query,env,'FIXTURE')
            self.assertEqual(str(ctx.exception),'JSON_RESPONSE_INVALID_FIXTURE')
    def test_12_wrong_json_type_refused(self):
        for value in ['null','[]','1']:
            with self.assertRaisesRegex(m.Refuse,'JSON_OBJECT_REQUIRED_FIXTURE'):
                m.psql_json("SELECT '"+value+"'::json;",env,'FIXTURE')
    def test_13_newline_tabular_outputs_unchanged(self):
        self.assertEqual(m.psql("SELECT true,'postgres',false; SELECT ''; SELECT '';",env),['t|postgres|f','',''])

if __name__=='__main__':unittest.main(verbosity=2)
