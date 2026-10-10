#!/usr/bin/env python3
"""Executor control-flow fault injection; DB calls are explicitly mocked here."""
import copy, importlib.util, json, os, pathlib, subprocess, tempfile, unittest
from contextlib import ExitStack
from unittest.mock import patch

root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('flow_executor',root/'run.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
INITIAL=copy.deepcopy(m.SUMMARY)
baseline=json.loads((root/'payload/baseline-catalog.json').read_text())
expected=json.loads((root/'payload/candidate-catalog.json').read_text())
history=[{'version':f'{i:014d}'} for i in range(126)]+[{'version':'20261008021536'}]
platform={'migration_history':history}

class Flow(unittest.TestCase):
    def exercise(self,mode):
        m.SUMMARY=copy.deepcopy(INITIAL);calls=[];snapshots=[];drains=0
        def versions(command,**kw):
            return subprocess.CompletedProcess(command,0,b'2.111.0\n' if command[0]==str(m.CLI) else b'psql (PostgreSQL) 18.6 fixture\n',b'')
        def snap(env,label):
            snapshots.append(label)
            if mode=='unknown' and label=='after-cli-error':raise m.Refuse('SNAPSHOT_UNAVAILABLE')
            if mode=='commit_response_lost' and label=='after-cli-error':return expected,{'migration_history':history+[{'version':m.VERSION}]}
            return baseline,platform
        def drain(env,active):
            nonlocal drains
            drains+=1
            if mode=='busy' and drains==1:raise m.Refuse('ACTIVE_WORK_PENDING_PAYSYNC')
            return {'fingerprint':{'count':2 if mode=='changed' and drains==3 else 1}}
        stop_attempted=False
        def cron(env,active):
            nonlocal stop_attempted
            calls.append(('cron',active));m.SUMMARY['cron_changed']=True
            if not active:
                stop_attempted=True
                if mode=='stop_response_lost':raise m.Refuse('MAINTENANCE_SQL_FAILED')
            m.SUMMARY['cron_changed']=not active
        def apply(*args):
            calls.append(('apply',));m.SUMMARY.update(attempted_apply=True,apply_invocations=1)
            return (1,True) if mode in ['rollback','unknown','commit_response_lost'] else (0,True)
        def post(*args):
            calls.append(('postcheck',))
            if mode=='postcheck_failed':raise m.Refuse('POST_CATALOG_MISMATCH')
            m.SUMMARY['schema_state']='APPLIED_AND_VERIFIED'
        with tempfile.TemporaryDirectory() as temp,ExitStack() as s:
            s.enter_context(patch.object(m,'PUBLIC',pathlib.Path(temp)))
            s.enter_context(patch.dict(os.environ,{'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF':'refs/heads/main','GITHUB_REPOSITORY':'byite-co/ssambership_web','GITHUB_RUN_ATTEMPT':'1'}))
            for name,value in {'verify_files':lambda:root,'connection_environment':lambda:('LOCAL_FIXTURE',{}),'check_context':lambda env:None,'snapshot':snap,'drain':drain,'dry_run':lambda *a:calls.append(('dry_run',)),'cron':cron,'apply_once':apply,'postcheck':post,'psql_json':lambda *a:{'pending_paysync':0}}.items():s.enter_context(patch.object(m,name,value))
            s.enter_context(patch.object(m.subprocess,'run',versions));s.enter_context(patch.object(m.time,'sleep',lambda _:None))
            failure=None
            try:m.main()
            except m.Refuse as e:failure=str(e)
        return calls,snapshots,failure
    def test_success_runs_one_apply_and_restores(self):
        calls,_,failure=self.exercise('success')
        self.assertIsNone(failure);self.assertEqual(calls.count(('apply',)),1)
        self.assertEqual(calls[-2:],[('postcheck',),('cron',True)])
    def test_initial_busy_does_not_stop_or_apply(self):
        calls,_,failure=self.exercise('busy');self.assertTrue(failure);self.assertEqual(calls,[])
    def test_changed_drain_restores_without_apply(self):
        calls,snapshots,failure=self.exercise('changed');self.assertEqual(failure,'DRAIN_CHANGED')
        self.assertNotIn(('apply',),calls);self.assertIn('maintenance-abort',snapshots);self.assertEqual(calls[-1],('cron',True))
    def test_stop_response_loss_reconciles_before_restore(self):
        calls,snapshots,failure=self.exercise('stop_response_lost')
        self.assertEqual(failure,'MAINTENANCE_SQL_FAILED');self.assertNotIn(('apply',),calls)
        self.assertIn('maintenance-abort',snapshots);self.assertEqual(calls[-1],('cron',True))
    def test_failed_apply_rollback_verifies_before_restore_no_retry(self):
        calls,snapshots,failure=self.exercise('rollback');self.assertEqual(failure,'CLI_DID_NOT_COMPLETE_NORMALLY')
        self.assertIn('after-cli-error',snapshots);self.assertEqual(calls.count(('apply',)),1)
        self.assertEqual(m.SUMMARY['schema_state'],'ROLLED_BACK_VERIFIED');self.assertFalse(m.SUMMARY['cron_changed'])
    def test_unknown_apply_does_not_restore_or_retry(self):
        calls,_,failure=self.exercise('unknown');self.assertTrue(failure)
        self.assertEqual(calls.count(('apply',)),1);self.assertNotIn(('cron',True),calls)
        self.assertTrue(m.SUMMARY['cron_changed'])
    def test_commit_response_loss_postchecks_without_retry(self):
        calls,_,failure=self.exercise('commit_response_lost');self.assertTrue(failure)
        self.assertEqual(calls.count(('apply',)),1);self.assertIn(('postcheck',),calls)
        self.assertNotIn(('cron',True),calls)
    def test_postcheck_failure_keeps_maintenance(self):
        calls,_,failure=self.exercise('postcheck_failed');self.assertEqual(failure,'POST_CATALOG_MISMATCH')
        self.assertNotIn(('cron',True),calls);self.assertEqual(calls.count(('apply',)),1)
    def test_cron_sql_failure_marks_uncertain_before_sending(self):
        m.SUMMARY=copy.deepcopy(INITIAL)
        with tempfile.TemporaryDirectory() as temp,patch.object(m,'PUBLIC',pathlib.Path(temp)),patch.object(m,'psql',side_effect=m.Refuse('MAINTENANCE_SQL_FAILED')):
            with self.assertRaises(m.Refuse):m.cron({},False)
        self.assertTrue(m.SUMMARY['cron_changed'])

if __name__=='__main__':unittest.main(verbosity=2)
