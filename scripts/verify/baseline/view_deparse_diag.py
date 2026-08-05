#!/usr/bin/env python3
"""view_deparse_diag.py — 뷰 정의 '실질 동등성' 판별 (deparse 서식 잡음 제거).

부모(PG17) 뷰 정의 텍스트를 로컬 PG16 에 diag 스키마로 재생성한 뒤,
같은 엔진의 pg_get_viewdef 로 로컬 뷰(파일판)와 재deparse 비교한다.
같으면 = 의미 동일(버전 간 서식 차이만), 다르면 = 실질 drift.

사용: view_deparse_diag.py <roundtrip_workdir> [parent_views.json]
전제: workdir 의 클러스터가 기동 가능해야 한다(스크립트가 직접 start/stop).
"""
import json, re, subprocess, sys

def main():
    W = sys.argv[1]
    vpath = sys.argv[2] if len(sys.argv) > 2 else '/workspace/baseline-work/inventory/views.json'
    pv = json.load(open(vpath))['views']
    PG = '/usr/lib/postgresql/16/bin'
    run = ['setpriv', '--reuid', 'postgres', '--regid', 'postgres', '--clear-groups']
    subprocess.run(run + [f'{PG}/pg_ctl', '-D', f'{W}/data', '-l', f'{W}/pgctl.log', '-o', f"-k {W} -c listen_addresses=''", '-w', 'start'],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    def psql(sql):
        r = subprocess.run(run + [f'{PG}/psql', '-h', W, '-U', 'postgres', '-d', 'postgres',
                                  '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(r.stderr[:400])
        return r.stdout.rstrip('\n')
    norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()
    same, diff = [], []
    try:
        psql('create schema if not exists viewdiag')
        for v in pv:
            local_def = psql(f"select pg_get_viewdef('{v['schema']}.{v['name']}'::regclass, false)")
            body = v['definition'].rstrip().rstrip(';')
            psql(f'drop view if exists viewdiag.x; create view viewdiag.x as {body}')
            parent_redep = psql("select pg_get_viewdef('viewdiag.x'::regclass, false)")
            (same if norm(local_def) == norm(parent_redep) else diff).append(f"{v['schema']}.{v['name']}")
        psql('drop schema if exists viewdiag cascade')
    finally:
        subprocess.run(run + [f'{PG}/pg_ctl', '-D', f'{W}/data', 'stop', '-m', 'fast'], capture_output=True)
    print('DEPARSE_EQUIVALENT:', len(same), same)
    print('REAL_DIFF:', len(diff), diff)
    return 1 if diff else 0

if __name__ == '__main__':
    sys.exit(main())
