#!/usr/bin/env python3
"""validate_db_workflows.py — DB 관련 GitHub Actions 워크플로 정적 검증 (지시서 §11·§21).

이 저장소의 워크플로 중 부모 Supabase 프로젝트를 건드릴 수 있는 것은 두 개뿐이다:
  .github/workflows/db-adoption-repair.yml   (Strategy A history repair)
  .github/workflows/db-apply-pr60.yml        (PR #60 guard 적용/롤백)
둘 다 아래 조건을 전부 만족해야 한다. 하나라도 깨지면 실패한다.

  R1  workflow_dispatch 전용 — push/pull_request/schedule 로 트리거되지 않는다
  R2  job 에 environment 승인 게이트가 있다
  R3  mode 입력의 기본값이 안전 모드(dry-run)다
  R4  confirmation 입력이 존재하고 기본값이 비어 있다
  R5  약속된 confirmation 상수 문자열이 워크플로 안에 그대로 있다
  R6  confirmation 불일치 시 exit 1 하는 게이트 스텝이 있다
  R7  permissions 가 contents: read 로 좁혀져 있다
  R8  concurrency 가 있고 cancel-in-progress 가 false 다 (실행 중 repair 를 끊지 않는다)
  R9  금지 토큰이 없다 (force push, history rewrite, --include-all, 부모에 fixture 실행 등)
  R10 모든 action 이 고정 버전으로 pin 돼 있다 (@main/@master 금지)
  R11 Supabase CLI 버전이 latest 가 아니라 고정 버전이다
  R12 검증 전용 워크플로는 secrets 를 참조하지 않는다

사용:
  validate_db_workflows.py            워크플로 검증
  validate_db_workflows.py --selftest 검증기 자체의 실패 탐지력 시험(변형 주입)
"""
from __future__ import annotations
import copy, re, sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    print('FAIL: PyYAML 이 필요하다 (pip install pyyaml)'); sys.exit(1)

REPO = Path(__file__).resolve().parents[3]
WF = REPO / '.github/workflows'

VERIFY_WF = 'db-migration-pack-verify.yml'
REMOTE_WF = {
    'db-adoption-repair.yml': {
        'environment': 'supabase-db-adoption',
        'safe_mode': 'dry-run',
        'confirmations': [
            'REPAIR_7_HISTORY_RECORDS_ON_lbeqxarxothkmzqvpudy',
            'REVERT_7_HISTORY_RECORDS_ON_lbeqxarxothkmzqvpudy',
        ],
    },
    'db-apply-pr60.yml': {
        'environment': 'supabase-db-adoption',
        'safe_mode': 'dry-run',
        'confirmations': [
            'APPLY_PR60_20260804113000_TO_lbeqxarxothkmzqvpudy',
            'ROLLBACK_PR60_20260804113000_ON_lbeqxarxothkmzqvpudy',
        ],
    },
}

# 부모를 건드릴 수 있는 워크플로에서 절대 나오면 안 되는 것들
FORBIDDEN = [
    (re.compile(r'push\s+--force|--force-with-lease|filter-branch|rebase\s+--onto'), 'force push / history rewrite'),
    (re.compile(r'--include-all'), 'db push --include-all (baseline 전량 재적용 위험)'),
    (re.compile(r'fixture'), '부모에 fixture 실행 (테스트 데이터 쓰기 금지)'),
    (re.compile(r'\bDROP\s+(TABLE|SCHEMA|DATABASE)\b', re.I), '파괴적 DDL'),
    (re.compile(r'(INSERT|UPDATE|DELETE)\s+.{0,40}schema_migrations', re.I | re.S),
     'migration history 내부 테이블 직접 조작'),
    (re.compile(r'supabase\s+db\s+reset'), 'db reset'),
    (re.compile(r'sbp_[A-Za-z0-9]{20,}|eyJhbGciOi[A-Za-z0-9_\-]{10,}'), 'hardcoded secret'),
]
ACTION_RE = re.compile(r'^\s*-?\s*uses:\s*([^\s#]+)', re.M)
UNPINNED = re.compile(r'@(main|master|latest|HEAD)$')


class Result:
    def __init__(self): self.fails: list[str] = []
    def bad(self, m): self.fails.append(m)


def norm_on(doc):
    """YAML 은 bare `on:` 을 boolean True 로 파싱한다."""
    return doc.get('on', doc.get(True, {}))


def check_remote(name: str, text: str, doc: dict, spec: dict, r: Result):
    p = f'{name}: '
    on = norm_on(doc)
    # R1
    if not isinstance(on, dict) or set(on) != {'workflow_dispatch'}:
        r.bad(p + f'R1 트리거가 workflow_dispatch 전용이 아니다: {sorted(on) if isinstance(on, dict) else on}')
    inputs = (on.get('workflow_dispatch') or {}).get('inputs', {}) if isinstance(on, dict) else {}

    jobs = doc.get('jobs') or {}
    if not jobs:
        r.bad(p + 'job 이 없다'); return
    for jn, job in jobs.items():
        # R2
        env = job.get('environment')
        env_name = env.get('name') if isinstance(env, dict) else env
        if env_name != spec['environment']:
            r.bad(p + f'R2 job {jn} 의 environment 가 {env_name!r} 다 ({spec["environment"]!r} 필요)')

    # R3
    mode = inputs.get('mode')
    if not mode:
        r.bad(p + 'R3 mode 입력이 없다')
    else:
        if mode.get('default') != spec['safe_mode']:
            r.bad(p + f'R3 mode 기본값이 {mode.get("default")!r} 다 ({spec["safe_mode"]!r} 필요)')
        opts = mode.get('options') or []
        if spec['safe_mode'] not in opts:
            r.bad(p + f'R3 mode options 에 {spec["safe_mode"]} 가 없다')

    # R4
    conf = inputs.get('confirmation')
    if conf is None:
        r.bad(p + 'R4 confirmation 입력이 없다')
    elif conf.get('default', '') != '':
        r.bad(p + f'R4 confirmation 기본값이 비어 있지 않다: {conf.get("default")!r}')

    # R5 — 상수는 (a) env 의 CONFIRM_* 값으로 정의되고 (b) 입력 설명에도 그대로 있어야 한다.
    #      둘을 함께 요구해야 "설명만 바꾸고 실제 게이트 값은 그대로" 같은 어긋남을 잡는다.
    wf_env = doc.get('env') or {}
    declared = {str(v) for k, v in wf_env.items() if k.startswith('CONFIRM_')}
    want = set(spec['confirmations'])
    if declared != want:
        r.bad(p + f'R5 env CONFIRM_* 값이 {sorted(declared)} 다 ({sorted(want)} 필요)')
    desc = str((conf or {}).get('description', ''))
    for c in spec['confirmations']:
        if c not in text:
            r.bad(p + f'R5 confirmation 상수 누락: {c}')
        elif c not in desc:
            r.bad(p + f'R5 confirmation 입력 설명에 상수 {c} 가 없다 (실행자가 값을 알 수 없다)')

    # R6 — 불일치 시 실패하는 게이트가 실제로 있어야 한다
    if not re.search(r'!=\s*"\$WANT"', text) or 'exit 1' not in text:
        r.bad(p + 'R6 confirmation 불일치 시 exit 1 하는 게이트를 찾을 수 없다')

    # R7
    perms = doc.get('permissions')
    if perms != {'contents': 'read'}:
        r.bad(p + f'R7 permissions 가 {perms!r} 다 ({{contents: read}} 필요)')

    # R8
    conc = doc.get('concurrency')
    if not isinstance(conc, dict) or not conc.get('group'):
        r.bad(p + 'R8 concurrency.group 이 없다')
    elif conc.get('cancel-in-progress') is not False:
        r.bad(p + f'R8 cancel-in-progress 가 {conc.get("cancel-in-progress")!r} 다 (false 필요)')

    # R9
    for pat, label in FORBIDDEN:
        if pat.search(text):
            r.bad(p + f'R9 금지 토큰 — {label}')


def check_common(name: str, text: str, doc: dict, r: Result):
    p = f'{name}: '
    # R10
    for u in ACTION_RE.findall(text):
        if UNPINNED.search(u) or '@' not in u:
            r.bad(p + f'R10 action 이 고정 버전이 아니다: {u}')
    # R11
    env = doc.get('env') or {}
    ver = env.get('SUPABASE_CLI_VERSION')
    if ver is not None and not re.fullmatch(r'\d+\.\d+\.\d+', str(ver)):
        r.bad(p + f'R11 SUPABASE_CLI_VERSION 이 고정 버전이 아니다: {ver!r}')
    if re.search(r'supabase/setup-cli', text) and ver is None:
        r.bad(p + 'R11 setup-cli 를 쓰면서 SUPABASE_CLI_VERSION 을 고정하지 않았다')


def check_verify(name: str, text: str, doc: dict, r: Result):
    p = f'{name}: '
    # R12 — 검증 전용 워크플로는 어떤 secret 도 참조하지 않는다
    hits = re.findall(r'secrets\.[A-Za-z_]+', text)
    if hits:
        r.bad(p + f'R12 검증 워크플로가 secret 을 참조한다: {sorted(set(hits))}')
    on = norm_on(doc)
    if not isinstance(on, dict) or 'pull_request' not in on:
        r.bad(p + 'pull_request 트리거가 없다 (PR 마다 자동 검증돼야 한다)')


def run(files: dict[str, str]) -> Result:
    """files: {filename: text}"""
    r = Result()
    for name in [VERIFY_WF] + sorted(REMOTE_WF):
        if name not in files:
            r.bad(f'{name} 이 없다'); continue
        text = files[name]
        try:
            doc = yaml.safe_load(text)
        except Exception as e:
            r.bad(f'{name}: YAML 파싱 실패 — {e}'); continue
        check_common(name, text, doc, r)
        if name == VERIFY_WF:
            check_verify(name, text, doc, r)
        else:
            check_remote(name, text, doc, REMOTE_WF[name], r)
    # 목록 밖의 워크플로가 부모 secret 을 쓰면 알린다
    for f in sorted(files):
        if f in REMOTE_WF or f == VERIFY_WF:
            continue
        if 'SUPABASE_DB_URL' in files[f] or 'SUPABASE_ACCESS_TOKEN' in files[f]:
            r.bad(f'{f}: 게이트 목록 밖의 워크플로가 부모 Supabase secret 을 참조한다')
    return r


MUTATIONS = [
    ('R1 push 트리거 추가', 'db-adoption-repair.yml',
     lambda t: t.replace('on:\n  workflow_dispatch:', 'on:\n  push:\n  workflow_dispatch:', 1)),
    ('R2 environment 제거', 'db-adoption-repair.yml',
     lambda t: t.replace('    environment: supabase-db-adoption   # 사람 승인 게이트\n', '', 1)),
    ('R3 기본값을 execute 로', 'db-adoption-repair.yml',
     lambda t: t.replace('        default: dry-run', '        default: execute-repair', 1)),
    ('R4 confirmation 기본값 주입', 'db-adoption-repair.yml',
     lambda t: t.replace("        required: false\n        default: ''",
                         "        required: false\n        default: 'REPAIR_7_HISTORY_RECORDS_ON_lbeqxarxothkmzqvpudy'", 1)),
    ('R5 confirmation 상수 변조', 'db-apply-pr60.yml',
     lambda t: t.replace('APPLY_PR60_20260804113000_TO_lbeqxarxothkmzqvpudy',
                         'APPLY_PR60_ANYTHING', 1)),
    ('R7 permissions 확대', 'db-apply-pr60.yml',
     lambda t: t.replace('permissions:\n  contents: read', 'permissions:\n  contents: write', 1)),
    ('R8 cancel-in-progress true', 'db-adoption-repair.yml',
     lambda t: t.replace('cancel-in-progress: false', 'cancel-in-progress: true', 1)),
    ('R9 --include-all 주입', 'db-apply-pr60.yml',
     lambda t: t.replace('supabase db push --db-url "$PGURL"',
                         'supabase db push --include-all --db-url "$PGURL"', 1)),
    ('R10 action pin 해제', 'db-migration-pack-verify.yml',
     lambda t: t.replace('actions/checkout@v4', 'actions/checkout@main', 1)),
    ('R11 CLI latest', 'db-migration-pack-verify.yml',
     lambda t: t.replace("SUPABASE_CLI_VERSION: '2.111.0'", "SUPABASE_CLI_VERSION: 'latest'", 1)),
    ('R12 검증 워크플로에 secret 참조', 'db-migration-pack-verify.yml',
     lambda t: t.replace('      - uses: actions/checkout@v4',
                         '      - uses: actions/checkout@v4\n      - run: echo ${{ secrets.SUPABASE_DB_URL }}', 1)),
    ('YAML 파손', 'db-adoption-repair.yml', lambda t: t + '\n  : : bad\n'),
]


def selftest(base: dict[str, str]) -> int:
    print('=== selftest: 변형을 주입해 검증기가 실제로 잡는지 확인')
    ok = True
    if run(base).fails:
        print('FAIL: 원본이 이미 실패한다 — selftest 이전에 본 검증을 통과시켜라'); return 1
    print('  ok  원본 PASS')
    for label, fname, mut in MUTATIONS:
        m = copy.deepcopy(base)
        before = m[fname]
        m[fname] = mut(before)
        if m[fname] == before:
            print(f'FAIL: [{label}] 변형이 적용되지 않았다 ({fname} 문자열 불일치)'); ok = False; continue
        res = run(m)
        if res.fails:
            print(f'  ok  [{label}] 검출됨 → {res.fails[0]}')
        else:
            print(f'FAIL: [{label}] 검증기가 놓쳤다'); ok = False
    # 파일 자체가 없어진 경우
    m = copy.deepcopy(base); del m['db-apply-pr60.yml']
    if not run(m).fails:
        print('FAIL: [워크플로 삭제] 검증기가 놓쳤다'); ok = False
    else:
        print('  ok  [워크플로 삭제] 검출됨')
    print('=' * 60)
    print('DB_WORKFLOW_SELFTEST: ' + ('PASS' if ok else 'FAIL'))
    return 0 if ok else 1


def main() -> int:
    if not WF.is_dir():
        print(f'FAIL: {WF} 가 없다'); return 1
    files = {p.name: p.read_text(encoding='utf-8') for p in sorted(WF.glob('*.yml'))}
    if '--selftest' in sys.argv:
        return selftest(files)
    print(f'=== workflows: {WF}  files={len(files)}')
    r = run(files)
    for name in [VERIFY_WF] + sorted(REMOTE_WF):
        mark = 'FAIL' if any(f.startswith(name + ':') for f in r.fails) else ' ok '
        print(f'  {mark} {name}')
    for f in r.fails:
        print('FAIL: ' + f)
    print('=' * 60)
    print('DB_WORKFLOW_VALIDATION: ' + ('PASS' if not r.fails else f'FAIL ({len(r.fails)})'))
    return 0 if not r.fails else 1


if __name__ == '__main__':
    sys.exit(main())
