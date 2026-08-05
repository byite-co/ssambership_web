#!/usr/bin/env python3
"""scan_repo_secrets.py — 검사 대상 경로에서 '비밀 값' 형태를 찾는다.

값 기준 스캔이다. 식별자 이름(project ref 등)은 대상이 아니다 — ref 는 대시보드 URL 에
노출되는 공개 식별자이고, 원본 source 의 출처 주석에 들어 있어 지울 수도 없다.
차단해야 하는 것은 **그 자체로 접근 권한을 주는 값**이다.

허용 예외(단 하나): Supabase 로컬 스택의 공개 기본 자격증명
    postgres(ql)://postgres:postgres@(127.0.0.1|localhost)[:port]/...
이것은 `supabase start` 가 모든 개발자 머신에 동일하게 띄우는 문서화된 기본값이며
루프백 전용이다. 비밀이 아니다. 그 외의 자격증명 포함 연결 문자열은 전부 차단한다.

사용:
  scan_repo_secrets.py [경로...]      기본: supabase/migrations supabase/baseline scripts/verify
  scan_repo_secrets.py --selftest     탐지/허용 규칙이 실제로 그렇게 동작하는지 시험
"""
from __future__ import annotations
import re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DEFAULT_PATHS = ['supabase/migrations', 'supabase/baseline', 'scripts/verify']

PATTERNS = [
    (re.compile(r'sbp_[A-Za-z0-9]{20,}'), 'supabase access token'),
    (re.compile(r'eyJhbGciOi[A-Za-z0-9_\-]{10,}'), 'JWT-like secret'),
    (re.compile(r'postgres(?:ql)?://[^\s\'"]*:[^\s\'"]*@[^\s\'"]*'), 'connection string with credentials'),
    (re.compile(r'SUPABASE_(?:ACCESS_TOKEN|DB_PASSWORD|SERVICE_ROLE_KEY|DB_URL)\s*[:=]\s*[\'"]?\S'),
     'secret value assignment'),
]

# 루프백 로컬 스택 기본값만 허용한다. 호스트가 루프백이 아니거나 자격증명이 다르면 걸린다.
LOCAL_DEV_URL = re.compile(
    r'^postgres(?:ql)?://postgres:postgres@(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:/|$)')


def scan_text(text: str) -> list[tuple[int, str, str]]:
    hits = []
    for n, line in enumerate(text.splitlines(), start=1):
        for pat, label in PATTERNS:
            for m in pat.finditer(line):
                s = m.group(0)
                if label == 'connection string with credentials' and LOCAL_DEV_URL.match(s):
                    continue
                if label == 'secret value assignment':
                    # `X: ${{ secrets.Y }}` 나 `X="$VAR"` 는 값이 아니라 참조다
                    tail = line[m.start():]
                    if 'secrets.' in tail or re.search(r'[:=]\s*[\'"]?\$', tail):
                        continue
                hits.append((n, label, s[:80]))
    return hits


def scan_paths(paths: list[str]) -> int:
    total = 0
    scanned = 0
    for rel in paths:
        base = REPO / rel
        files = sorted(base.rglob('*')) if base.is_dir() else [base]
        for f in files:
            if not f.is_file():
                continue
            try:
                text = f.read_text(encoding='utf-8', errors='replace')
            except OSError:
                continue
            scanned += 1
            for n, label, s in scan_text(text):
                print(f'FAIL: {f.relative_to(REPO)}:{n}: {label} — {s}')
                total += 1
    print(f'  scanned files: {scanned}')
    print('SECRET_SCAN: ' + ('PASS' if not total else f'FAIL ({total})'))
    return 0 if not total else 1


# selftest 표본은 **런타임에 조립한다.** 토큰 모양 리터럴을 파일에 두면
# GitHub push protection 이 진짜 자격증명으로 판정해 push 를 거부한다(실제로 겪었다).
# 조립해 두면 이 파일 자체가 스캔 대상에 남아 있어도 오탐이 나지 않는다.
_SBP = 'sbp' + '_' + ('a1b2c3d4e5' * 4)
_JWT = 'eyJhbGciOi' + 'JIUzI1NiIsInR5cCI6IkpXVCJ9'
_PG = 'postgres' + 'ql://'


def _url(user_pass: str, host: str) -> str:
    return f'{_PG}{user_pass}@{host}/postgres'


CASES = [
    # (본문, 걸려야 하는가, 설명)
    ('DB_URL="${LOCAL_DB_URL:-' + _url('postgres:postgres', '127.0.0.1:54322') + '}"',
     False, '로컬 스택 기본값(루프백)은 허용'),
    ('url = "' + _url('postgres:postgres', 'localhost') + '"', False, 'localhost 도 허용'),
    ('url = "' + _url('postgres:hunter2', '127.0.0.1:5432') + '"', True, '다른 비밀번호는 차단'),
    ('url = "' + _url('postgres:postgres', 'db.example.supabase.co:5432') + '"',
     True, '원격 호스트는 차단'),
    (f'token = "{_SBP}"', True, 'access token 차단'),
    (f'key = "{_JWT}"', True, 'JWT 형태 차단'),
    ('SUPABASE_DB_' + 'PASSWORD=s3cr3tvalue', True, '비밀값 대입 차단'),
    ('SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}', False, 'secret 참조는 값이 아니다'),
    ('PGURL: ${{ secrets.SUPABASE_DB_URL }}', False, 'secret 참조는 값이 아니다'),
    ('SUPABASE_ACCESS_TOKEN="$MY_TOKEN"', False, '환경변수 참조는 값이 아니다'),
    ('-- 출처: staging lbeqxarxothkmzqvpudy read-only 실조회', False,
     'project ref 언급은 비밀이 아니다'),
]


def selftest() -> int:
    print('=== selftest: 탐지/허용 규칙')
    ok = True
    for text, should_hit, why in CASES:
        hit = bool(scan_text(text))
        if hit == should_hit:
            print(f'  ok  {"차단" if should_hit else "허용"} — {why}')
        else:
            print(f'FAIL: {why} — 기대 {"차단" if should_hit else "허용"}, 실제 '
                  f'{"차단" if hit else "허용"}: {text}')
            ok = False
    print('=' * 60)
    print('SECRET_SCAN_SELFTEST: ' + ('PASS' if ok else 'FAIL'))
    return 0 if ok else 1


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--selftest']
    sys.exit(selftest() if '--selftest' in sys.argv else scan_paths(args or DEFAULT_PATHS))
