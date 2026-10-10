#!/usr/bin/env python3
"""Local executor gate tests only; no DB/network/financial regression claims."""
import copy, importlib.util, pathlib, unittest
root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('executor_under_test',root/'run.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Gates(unittest.TestCase):
    def drain(self):
        d={k:0 for k in ['busy','other_postgres','pending_paysync','pending_payments','outbox_leased','deletion_leased','cron_running']}
        d['cron']=[{'id':i,'name':name,'owner':'postgres','active':False} for i,name in enumerate(m.JOBS)]
        return d
    def test_clear_drain(self):m.check_drain(self.drain(),False)
    def test_each_live_writer_and_payment_blocks(self):
        for key in ['busy','other_postgres','pending_paysync','pending_payments','outbox_leased','deletion_leased','cron_running']:
            with self.subTest(key=key):
                d=self.drain();d[key]=1
                with self.assertRaises(m.Refuse):m.check_drain(d,False)
    def test_wrong_owner_blocks(self):
        d=self.drain();d['cron'][0]['owner']='supabase_admin'
        with self.assertRaises(m.Refuse):m.check_drain(d,False)
    def test_active_cron_blocks(self):
        d=self.drain();d['cron'][0]['active']=True
        with self.assertRaises(m.Refuse):m.check_drain(d,False)
    def test_extra_cron_blocks(self):
        d=self.drain();d['cron'].append({'name':'new_job','owner':'postgres','active':False})
        with self.assertRaises(m.Refuse):m.check_drain(d,False)
    def test_exact_prompt_accepts(self):
        s=('Do you want to push these migrations to the remote database?\n • '+m.FILENAME+'\n● Yes / ○ No').encode()
        self.assertEqual(m.prompt_ready(s),'accept')
    def test_extra_pending_prompt_rejects(self):
        s=('Do you want to push these migrations to the remote database?\n'+m.FILENAME+'\n20261009070100_staging_compensation.sql\nYes No').encode()
        self.assertEqual(m.prompt_ready(s),'reject')
    def test_automatic_apply_is_rejected(self):
        self.assertEqual(m.prompt_ready(b'Applying migration 20261009070000_staging_integration.sql'),'unexpected-apply')
    def test_partial_prompt_waits(self):
        self.assertEqual(m.prompt_ready(b'Do you want to push these migrations'),'wait')
    def test_wrong_history_count_blocks(self):
        with self.assertRaises(m.Refuse):m.check_history({'migration_history':[]},127,'20261008021536')
    def test_missing_tls_gets_explicit_requirement_without_reencoding(self):
        uri='postgresql://u:p%40%3F%26%23@host:5432/db?application_name=a%20b&connect_timeout=10'
        self.assertEqual(m.require_tls_uri(uri),uri+'&sslmode=require')
    def test_plain_uri_gets_requirement(self):
        uri='postgresql://u:p@host:5432/db'
        self.assertEqual(m.require_tls_uri(uri),uri+'?sslmode=require')
    def test_stronger_existing_tls_is_preserved(self):
        for mode in ['require','verify-ca','verify-full']:
            uri='postgresql://u:p@host:5432/db?sslmode='+mode+'&application_name=a%20b'
            self.assertEqual(m.require_tls_uri(uri),uri)
    def test_weak_empty_or_duplicate_tls_is_refused(self):
        for query in ['sslmode=disable','sslmode=allow','sslmode=prefer','sslmode=','sslmode=require&sslmode=disable','sslmode=verify-full&sslmode=require']:
            with self.subTest(query=query),self.assertRaises(m.Refuse):
                m.require_tls_uri('postgresql://u:p@host:5432/db?'+query)
    def test_non_uri_or_fragment_is_refused(self):
        for value in ['host=example user=postgres','postgresql://u:p@host:5432/db#sslmode=require']:
            with self.assertRaises(m.Refuse):m.require_tls_uri(value)
    def test_psql18_client_tls_metadata(self):
        rows=['Database|fixture','SSL Connection|true','SSL Protocol|TLSv1.3','SSL Cipher|TLS_AES_256_GCM_SHA384']
        self.assertTrue(m.check_client_tls(rows)['ssl_in_use'])
    def test_plain_connection_metadata_is_refused(self):
        with self.assertRaises(m.Refuse):m.check_client_tls(['SSL Connection|false'])
    def test_protocol_or_cipher_missing_is_refused(self):
        for rows in [['SSL Connection|true'],['SSL Connection|true','SSL Protocol|TLSv1.3'],['SSL Connection|true','SSL Protocol|unknown','SSL Cipher|unknown']]:
            with self.assertRaises(m.Refuse):m.check_client_tls(rows)
    def test_duplicate_ssl_metadata_is_refused(self):
        with self.assertRaises(m.Refuse):m.check_client_tls(['SSL Connection|false','SSL Connection|true','SSL Protocol|TLSv1.3','SSL Cipher|fixture'])
    def test_non_client_ssl_evidence_is_refused(self):
        for rows in [['pg_stat_ssl|true'],['SSL connection (protocol TLSv1.3)'],['SSL Connection|false','SSL Protocol|TLSv1.3','SSL Cipher|fixture']]:
            with self.assertRaises(m.Refuse):m.check_client_tls(rows)

if __name__=='__main__':unittest.main()
