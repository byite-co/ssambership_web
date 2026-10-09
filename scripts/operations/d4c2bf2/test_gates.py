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

if __name__=='__main__':unittest.main()
