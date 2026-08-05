#!/usr/bin/env python3
"""build_native_migration_pack.py — PR #61 정식 migration pack(63본) 생성.

구성 (지시서 §9):
  1  baseline   : 20260701000000_pre_ledger_baseline.sql (생성기 산출물)
  56 ledger     : supabase/baseline/ledger_replay/**   (version 보존, binary copy)
  6  interleave : supabase/baseline/interleaves/**     (version 보존, binary copy)
  = 63

금지: SQL 재포맷 · version 변경 · 내용 변경 · 현재시각 version · symlink ·
      source 삭제 후 migration 만 남기기.

출력: supabase/migrations/*.sql (63본)
      supabase/baseline/native_migration_pack_manifest.tsv

PR #60 의 20260804113000 은 이 pack 에 포함하지 않는다 — PR #60 branch 소유다.

사용: python3 build_native_migration_pack.py [--check]
"""
from __future__ import annotations
import hashlib, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
MIG = REPO / 'supabase/migrations'
LEDGER_DIR = REPO / 'supabase/baseline/ledger_replay'
INTER_DIR = REPO / 'supabase/baseline/interleaves'
BASELINE_OUT = MIG / '20260701000000_pre_ledger_baseline.sql'
MANIFEST = REPO / 'supabase/baseline/native_migration_pack_manifest.tsv'
REPAIR_PLAN = REPO / 'supabase/baseline/adoption_repair_plan.tsv'

VERSION_RE = re.compile(r'^(\d{14})_(.+)\.sql$')
EXPECT = {'baseline': 1, 'ledger': 56, 'interleave': 6}
PR60_VERSION = '20260804113000'   # PR #60 소유 — 이 pack 에 없어야 정상


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def parse(p: Path):
    m = VERSION_RE.match(p.name)
    if not m:
        sys.exit(f'FAIL: version 형식 아님: {p.name}')
    return m.group(1), m.group(2)


def strategy_a_versions():
    rows = REPAIR_PLAN.read_text(encoding='utf-8').splitlines()[1:]
    return {r.split('\t')[1] for r in rows if r.strip()}


def plan():
    items = []
    if not BASELINE_OUT.exists():
        sys.exit('FAIL: baseline migration 이 없다. build_native_baseline_migration.py 를 먼저 실행하라.')
    bver, bname = parse(BASELINE_OUT)
    items.append({'kind': 'baseline', 'version': bver, 'name': bname,
                  'source': BASELINE_OUT, 'output': BASELINE_OUT})
    for d, kind in ((LEDGER_DIR, 'ledger'), (INTER_DIR, 'interleave')):
        for src in sorted(d.glob('*.sql')):
            ver, name = parse(src)
            items.append({'kind': kind, 'version': ver, 'name': name,
                          'source': src, 'output': MIG / src.name})
    counts = {k: sum(1 for i in items if i['kind'] == k) for k in EXPECT}
    for k, want in EXPECT.items():
        if counts[k] != want:
            sys.exit(f'FAIL: {k} {counts[k]} != {want}')
    items.sort(key=lambda i: i['version'])
    vs = [i['version'] for i in items]
    if len(set(vs)) != len(vs):
        dup = sorted({v for v in vs if vs.count(v) > 1})
        sys.exit(f'FAIL: duplicate version {dup}')
    if vs != sorted(vs):
        sys.exit('FAIL: version 정렬 실패')
    if PR60_VERSION in vs:
        sys.exit(f'FAIL: PR60 version {PR60_VERSION} 은 PR #61 pack 에 포함될 수 없다')
    sa = strategy_a_versions()
    missing = sorted(sa - set(vs))
    if missing:
        sys.exit(f'FAIL: Strategy A version 누락 {missing}')
    return items


def manifest_text(items):
    cols = ['order', 'version', 'kind', 'source_path', 'output_path', 'source_sha256',
            'output_sha256', 'source_size', 'output_size', 'expected_parent_status',
            'strategy_a_record']
    sa = strategy_a_versions()
    lines = ['\t'.join(cols)]
    for n, i in enumerate(items, start=1):
        sb = i['source'].read_bytes()
        ob = i['output'].read_bytes() if i['output'].exists() else sb
        lines.append('\t'.join([
            str(n), i['version'], i['kind'],
            str(i['source'].relative_to(REPO)), str(i['output'].relative_to(REPO)),
            sha256(sb), sha256(ob), str(len(sb)), str(len(ob)),
            'applied_via_strategy_a' if i['version'] in sa else 'applied_existing_ledger',
            'yes' if i['version'] in sa else 'no']))
    return ('\n'.join(lines) + '\n').encode()


def main():
    check = '--check' in sys.argv
    items = plan()
    problems = []
    for i in items:
        if i['source'] == i['output']:
            continue          # baseline: 생성기가 이미 migrations/ 에 직접 쓴다
        sb = i['source'].read_bytes()
        if check:
            if not i['output'].exists() or i['output'].read_bytes() != sb:
                problems.append(str(i['output'].relative_to(REPO)))
        else:
            i['output'].write_bytes(sb)     # binary copy, 내용 무변경
    mtext = manifest_text(items)
    if check:
        if not MANIFEST.exists() or MANIFEST.read_bytes() != mtext:
            problems.append(str(MANIFEST.relative_to(REPO)))
        # migrations/ 안에 계획 밖 파일이 있으면 실패.
        # 단 PR #60 소유 migration(20260804113000)은 pack 생성기 산출물이 아니라
        # 별도 PR 이 소유하는 정식 migration 이므로, 병합 후 공존 상태를 정상으로 본다.
        # (source ↔ migration 동기화는 check_pr60_native_migration_sync.sh 가 강제한다.)
        planned = {i['output'].name for i in items}
        extra = sorted(p.name for p in MIG.glob('*.sql')
                       if p.name not in planned and not p.name.startswith(PR60_VERSION + '_'))
        if extra:
            problems.append('EXTRA:' + ','.join(extra))
        if problems:
            print('PACK_CHECK: FAIL — ' + '; '.join(problems))
            return 1
        print(f'PACK_CHECK: PASS ({len(items)} migrations)')
        return 0
    MANIFEST.write_bytes(mtext)
    counts = {k: sum(1 for i in items if i['kind'] == k) for k in EXPECT}
    print(f"wrote {len(items)} migrations → supabase/migrations/  "
          f"(baseline {counts['baseline']} · ledger {counts['ledger']} · interleave {counts['interleave']})")
    print(f'wrote {MANIFEST.relative_to(REPO)}')
    print(f'first={items[0]["version"]} last={items[-1]["version"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
