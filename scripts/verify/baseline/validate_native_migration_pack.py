#!/usr/bin/env python3
"""validate_native_migration_pack.py — 정식 migration pack 정적 검증 (지시서 §11).

기본은 PR #61 pack(63본) 검증. --with-pr60 <dir> 을 주면 임시 통합 pack(64본)을 검증한다.

검사: 파일 수 · version 형식/오름차순/중복 · source checksum · 생성물 최신 여부 ·
      ordering 제약 · adoption_repair_plan 대조 · 금지 내용 · transaction 경고 존재.
종료코드 0=PASS, 1=FAIL, 2=사용법 오류.
"""
from __future__ import annotations
import hashlib, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
MIG = REPO / 'supabase/migrations'
MANIFEST = REPO / 'supabase/baseline/native_migration_pack_manifest.tsv'
REPAIR_PLAN = REPO / 'supabase/baseline/adoption_repair_plan.tsv'
BASELINE_MANIFEST = REPO / 'supabase/baseline/native_baseline_manifest.json'
VERSION_RE = re.compile(r'^(\d{14})_(.+)\.sql$')

PR60_VERSION = '20260804113000'
M13_VERSION = '20260731100540'
FN_HARDENING = '20260729000000'
TBL_HARDENING = '20260802000000'
IQ_INTERLEAVE = '20260715000000'
LAST_LEDGER = '20260804040019'
POST_LEDGER = ['20260804100000', '20260804100001', '20260804100002']
STRATEGY_A = ['20260701000000', IQ_INTERLEAVE, FN_HARDENING, TBL_HARDENING] + POST_LEDGER

FORBIDDEN_PATTERNS = [
    (re.compile(rb'^\s*\\(connect|i|ir|copy|include)\b', re.M), 'psql meta command'),
    (re.compile(rb'\bCREATE\s+DATABASE\b', re.I), 'CREATE DATABASE'),
    (re.compile(rb'\bsbp_[A-Za-z0-9]{20,}'), 'supabase access token'),
    (re.compile(rb'eyJhbGciOi[A-Za-z0-9_\-]{10,}'), 'JWT-like secret'),
    (re.compile(rb'postgres(ql)?://[^\s\'"]*:[^\s\'"]*@'), 'connection string with credentials'),
    # 주의: 벌거벗은 project ref 문자열은 금지 대상이 아니다. ref 는 대시보드 URL 에 노출되는
    # 공개 식별자이고, 원본 source 의 출처 주석("staging <ref> read-only 실조회")에 그대로
    # 들어 있다. migration 은 source 와 byte 동일해야 하므로 주석을 지우는 것은 허용되지 않는다.
    # 실제로 위험한 것은 endpoint URL 과 자격증명이므로 그 형태만 차단하고,
    # 주석 언급 횟수는 아래에서 정보성으로 보고한다.
    (re.compile(rb'[a-z]{20}\.supabase\.(co|in)'), 'supabase endpoint URL'),
    (re.compile(rb'SUPABASE_(ACCESS_TOKEN|DB_PASSWORD|SERVICE_ROLE_KEY)\s*[:=]\s*\S'), 'secret value assignment'),
]
PARENT_REF_MENTION = re.compile(rb'lbeqxarxothkmzqvpudy')

fails: list[str] = []
def bad(msg): fails.append(msg); print(f'FAIL: {msg}')
def ok(msg): print(f'  ok  {msg}')


def sha256(b: bytes) -> str: return hashlib.sha256(b).hexdigest()


def main() -> int:
    args = sys.argv[1:]
    pack_dir, with_pr60 = MIG, False
    if '--with-pr60' in args:
        i = args.index('--with-pr60')
        if i + 1 >= len(args):
            print('usage: --with-pr60 <dir>'); return 2
        pack_dir, with_pr60 = Path(args[i + 1]), True

    files = sorted(pack_dir.glob('*.sql'))
    # PR #60(20260804113000) 병합 전에는 63본, 병합 후에는 64본이 정상이다.
    # 어느 쪽인지는 디렉터리 실측으로 판정한다 — 플래그로 거짓말할 수 없다.
    if not with_pr60:
        with_pr60 = any(f.name.startswith(PR60_VERSION + '_') for f in files)
        if with_pr60:
            print('  (통합 상태 감지: PR60 migration 존재 → 64본 기준으로 검증)')
    expect_total = 64 if with_pr60 else 63
    print(f'=== pack: {pack_dir}  files={len(files)} (expect {expect_total})')
    if len(files) != expect_total:
        bad(f'migration file count {len(files)} != {expect_total}')

    # A. version 형식 / 정렬 / 중복
    versions = []
    for f in files:
        m = VERSION_RE.match(f.name)
        if not m:
            bad(f'version 형식 위반: {f.name}'); continue
        versions.append(m.group(1))
    if versions != sorted(versions):
        bad('version 이 오름차순이 아니다')
    else:
        ok('version strictly ascending')
    dups = sorted({v for v in versions if versions.count(v) > 1})
    if dups: bad(f'duplicate version {dups}')
    else: ok('duplicate version 0')

    vset = set(versions)

    # B. 구성 수
    if not with_pr60:
        if PR60_VERSION in vset:
            bad(f'PR61 pack 에 PR60 version {PR60_VERSION} 이 포함됐다')
        else:
            ok('PR60 version 미포함 (PR #60 branch 소유)')
    else:
        if PR60_VERSION not in vset:
            bad(f'통합 pack 에 PR60 version {PR60_VERSION} 이 없다')
        elif versions[-1] != PR60_VERSION:
            bad(f'마지막 version 이 {versions[-1]} — {PR60_VERSION} 이어야 한다')
        else:
            ok(f'PR60 version 이 마지막 ({PR60_VERSION})')

    # C. 생성물 최신 여부 (직접 편집 탐지)
    for gen in ('build_native_baseline_migration.py', 'build_native_migration_pack.py'):
        r = subprocess.run([sys.executable, str(REPO / 'scripts/verify/baseline' / gen), '--check'],
                           capture_output=True, text=True)
        if r.returncode != 0:
            bad(f'{gen} --check 실패: {r.stdout.strip()} {r.stderr.strip()}')
        else:
            ok(f'{gen} --check PASS')

    # D. ordering 제약
    def pos(v): return versions.index(v) if v in vset else -1
    checks = [
        ('baseline 이 첫 version', versions and versions[0] == '20260701000000'),
        (f'{IQ_INTERLEAVE} 이 baseline 뒤', pos(IQ_INTERLEAVE) > pos('20260701000000')),
        (f'{FN_HARDENING} 이 M13({M13_VERSION}) 보다 앞', 0 <= pos(FN_HARDENING) < pos(M13_VERSION)),
        (f'{TBL_HARDENING} 이 M13 뒤', pos(TBL_HARDENING) > pos(M13_VERSION)),
    ]
    for v in POST_LEDGER:
        checks.append((f'{v} 이 마지막 원장({LAST_LEDGER}) 뒤', pos(v) > pos(LAST_LEDGER)))
    for label, cond in checks:
        ok(label) if cond else bad(label)

    # E. adoption_repair_plan 대조
    rows = [r for r in REPAIR_PLAN.read_text(encoding='utf-8').splitlines()[1:] if r.strip()]
    if len(rows) != 7:
        bad(f'adoption_repair_plan 행 {len(rows)} != 7')
    else:
        ok('adoption_repair_plan 7행')
    for r in rows:
        c = r.split('\t')
        ver, ddl, sch = c[1], c[6], c[7]
        if ver not in vset: bad(f'repair plan version {ver} 에 해당하는 migration 파일 없음')
        if ddl != 'no': bad(f'repair plan {ver}: ddl_executed={ddl} (no 여야 함)')
        if sch != 'no': bad(f'repair plan {ver}: schema_change_expected={sch} (no 여야 함)')
    missing = [v for v in STRATEGY_A if v not in vset]
    if missing: bad(f'Strategy A version 누락 {missing}')
    else: ok('Strategy A 7 version 전부 존재')

    # F. source checksum (manifest 대조)
    if MANIFEST.exists():
        mrows = [r.split('\t') for r in MANIFEST.read_text(encoding='utf-8').splitlines()[1:] if r.strip()]
        mism = 0
        for c in mrows:
            outp = REPO / c[4]
            if not outp.exists(): bad(f'manifest 대상 파일 없음: {c[4]}'); mism += 1; continue
            if sha256(outp.read_bytes()) != c[6]: bad(f'checksum 불일치: {c[4]}'); mism += 1
        if not mism: ok(f'manifest checksum {len(mrows)}/{len(mrows)} 일치')
    else:
        bad('native_migration_pack_manifest.tsv 없음')

    # G. 금지 내용
    hits = 0
    for f in files:
        b = f.read_bytes()
        for pat, label in FORBIDDEN_PATTERNS:
            if pat.search(b):
                bad(f'{f.name}: 금지 내용 — {label}'); hits += 1
    if not hits: ok('금지 내용 0 (psql meta/CREATE DATABASE/secret/endpoint URL)')
    ref_files = sorted(f.name for f in files if PARENT_REF_MENTION.search(f.read_bytes()))
    if ref_files:
        print(f'  info parent project ref 주석 언급 {len(ref_files)}개 파일 '
              f'(출처 주석, endpoint URL·자격증명 아님): {", ".join(ref_files[:3])}'
              + (' …' if len(ref_files) > 3 else ''))

    # H. transaction 비원자성 경고가 baseline 과 manifest 에 남아 있어야 한다
    bl = pack_dir / '20260701000000_pre_ledger_baseline.sql'
    if bl.exists():
        head = bl.read_bytes()[:4000]
        if b'BASELINE_ATOMICITY: NOT_GUARANTEED' not in head:
            bad('baseline migration 헤더에 비원자성 경고가 없다')
        else:
            ok('baseline 비원자성 경고 존재')
    if BASELINE_MANIFEST.exists():
        if b'NOT_GUARANTEED' not in BASELINE_MANIFEST.read_bytes():
            bad('native_baseline_manifest.json 에 비원자성 표기가 없다')
        else:
            ok('manifest 비원자성 표기 존재')

    print('=' * 60)
    print('NATIVE_MIGRATION_PACK_VALIDATION: ' + ('PASS' if not fails else f'FAIL ({len(fails)})'))
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(main())
