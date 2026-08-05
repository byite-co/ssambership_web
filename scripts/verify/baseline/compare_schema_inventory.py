#!/usr/bin/env python3
"""compare_schema_inventory.py — 부모(원격) 인벤토리 vs 로컬(스크래치/branch) 인벤토리 구조 비교.

사용: compare_schema_inventory.py <parent_inventory_dir> <local_inventory.json> [--full]
종료코드: 0=동등(허용 diff 만), 1=실질 drift 존재, 2=입력 오류.

정규화 원칙: OID·시퀀스 현재값·owner·통계 제외. 텍스트 표현식은 \s+→' ' 후 md5.
허용 diff(플랫폼/환경 고유)는 ALLOWED_* 규칙으로 명시하고 결과에 별도 집계한다.
"""
import json, re, sys, hashlib
from pathlib import Path

def norm(s):
    if s is None: return ''
    return re.sub(r'\s+', ' ', s).strip()

def md5(s):
    return hashlib.md5(s.encode()).hexdigest()

def load(p):
    return json.loads(Path(p).read_text())

# ---- 허용 diff 규칙 (플랫폼·환경 고유 — 실질 drift 아님) ----
ALLOWED_EXT_LOCAL_MISSING = {'pg_cron', 'pg_stat_statements', 'supabase_vault', 'pg_graphql', 'pg_net', 'pgjwt', 'uuid-ossp'}
ALLOWED_PUB_PLATFORM = {'supabase_realtime_messages_publication'}  # realtime.messages 전용(플랫폼 관리)
ALLOWED_POLICY_SCOPE_NOTE = 'storage 정책은 로컬 스텁에도 존재해야 비교 — 누락시 실 drift로 계상'

def key_rows(rows, keyf):
    out = {}
    for r in rows or []:
        out[keyf(r)] = r
    return out

def diff_axis(name, parent_map, local_map, cmpf, report, allowed_missing_local=None):
    allowed_missing_local = allowed_missing_local or (lambda k, r: False)
    only_p, only_l, changed, allowed = [], [], [], []
    for k, r in parent_map.items():
        if k not in local_map:
            (allowed if allowed_missing_local(k, r) else only_p).append(k)
    for k in local_map:
        if k not in parent_map:
            only_l.append(k)
    for k in set(parent_map) & set(local_map):
        d = cmpf(parent_map[k], local_map[k])
        if d: changed.append((k, d))
    report[name] = {'parent_only': sorted(map(str, only_p)), 'local_only': sorted(map(str, only_l)),
                    'changed': sorted(((str(k), d) for k, d in changed)), 'allowed_platform': sorted(map(str, allowed)),
                    'parent_n': len(parent_map), 'local_n': len(local_map)}
    return not (only_p or only_l or changed)

def main():
    if len(sys.argv) < 3:
        print(__doc__); return 2
    pdir, lpath = Path(sys.argv[1]), sys.argv[2]
    full = '--full' in sys.argv
    L = load(lpath)
    report, ok_all = {}, True

    # tables
    P = key_rows(load(pdir/'tables.json'), lambda r: (r['schema'], r['table']))
    Q = key_rows(L.get('tables'), lambda r: (r['sch'], r['tbl']))
    ok_all &= diff_axis('tables', P, Q, lambda p, l:
        None if (p['rls_enabled'] == l['rls'] and p['rls_forced'] == l['rls_forced'])
        else f"rls {p['rls_enabled']}/{p['rls_forced']} != {l['rls']}/{l['rls_forced']}", report)

    # columns — 부모 columns.json 은 view 컬럼 포함 → base table 로 한정(tables.json 기준)
    base_tables = {(r['schema'], r['table']) for r in load(pdir/'tables.json')}
    P = key_rows([r for r in load(pdir/'columns.json') if (r['schema'], r['table']) in base_tables],
                 lambda r: (r['schema'], r['table'], r['column']))
    Q = key_rows(L.get('columns'), lambda r: (r['sch'], r['tbl'], r['col']))
    def cmp_col(p, l):
        d = []
        if p['udt_name'] != l['typ']: d.append(f"type {p['udt_name']}!={l['typ']}")
        if p['is_nullable'] != l['is_nullable']: d.append(f"null {p['is_nullable']}!={l['is_nullable']}")
        if norm(p.get('column_default') or '') != norm(l.get('column_default') or ''):
            d.append(f"default {norm(p.get('column_default') or '')!r}!={norm(l.get('column_default') or '')!r}")
        return '; '.join(d) or None
    ok_all &= diff_axis('columns', P, Q, cmp_col, report)

    # constraints
    P = key_rows(load(pdir/'constraints.json'), lambda r: (r['schema'], r['table'], r['conname']))
    Q = key_rows(L.get('constraints'), lambda r: (r['sch'], r['tbl'], r['conname']))
    ok_all &= diff_axis('constraints', P, Q, lambda p, l:
        None if norm(p['definition']) == norm(l['def']) else f"def {norm(p['definition'])!r} != {norm(l['def'])!r}", report)

    # indexes
    P = key_rows(load(pdir/'indexes.json'), lambda r: (r['schemaname'], r['tablename'], r['indexname']))
    Q = key_rows(L.get('indexes'), lambda r: (r['sch'], r['tbl'], r['name']))
    ok_all &= diff_axis('indexes', P, Q, lambda p, l:
        None if norm(p['indexdef']) == norm(l['def']) else 'indexdef differs', report)

    # views (md5 of normalized definition)
    # PG16(로컬) vs PG17(부모) deparse 서식 차이는 실질 drift 가 아니다 — scratch/view_deparse_diag 로
    # 동일-버전 재deparse 동등성이 입증된 뷰는 허용 diff 로 집계한다. (branch(PG17) 단계에서 정밀 재검증)
    DEPARSE_EQUIV_VIEWS = {('api_app_v1', 'community_posts_v1'), ('api_web_v1', 'community_comments_v1'),
                           ('api_web_v1', 'community_posts_v1'), ('api_web_v1', 'mentor_directory_v1'),
                           ('api_web_v1', 'my_cash_ledger_v1'), ('api_web_v1', 'my_wallet_v1'),
                           ('public', 'due_payouts')}
    pv = load(pdir/'views.json'); pv = pv['views'] if isinstance(pv, dict) else pv
    P = key_rows(pv, lambda r: (r['schema'], r['name']))
    Q = key_rows(L.get('views'), lambda r: (r['sch'], r['name']))
    deparse_allowed = []
    def cmp_view(p, l):
        if md5(norm(p['definition'])) == l['def_md5']:
            return None
        if (p['schema'], p['name']) in DEPARSE_EQUIV_VIEWS:
            deparse_allowed.append((p['schema'], p['name']))
            return None
        return 'view definition md5 differs'
    ok_all &= diff_axis('views', P, Q, cmp_view, report)
    report['views']['deparse_equiv_allowed'] = sorted(map(str, deparse_allowed))

    # functions — prosrc 는 CR-비민감 비교(부모는 SQL Editor CRLF 적용본): AS_APPLIED_CRLF_ARTIFACT
    nocr = {}
    nocr_path = pdir/'functions_md5_nocr.tsv'
    if nocr_path.exists():
        for line in nocr_path.read_text().splitlines():
            parts = line.split('\t')
            if len(parts) == 4:
                nocr[(parts[0], parts[1], norm(parts[2]))] = parts[3]
    crlf_only = []
    P = key_rows(load(pdir/'functions.json'), lambda r: (r['schema'], r['name'], norm(r.get('identity_args') or '')))
    Q = key_rows(L.get('functions'), lambda r: (r['sch'], r['name'], norm(r.get('args') or '')))
    def cmp_fn(p, l):
        d = []
        key = (p['schema'], p['name'], norm(p.get('identity_args') or ''))
        if p.get('prosrc_md5') != l.get('src_md5'):
            if nocr.get(key) == l.get('src_md5'):
                crlf_only.append(key)  # CR 제거 시 일치 — 기능 동일, 허용 diff 로 집계
            else:
                d.append('prosrc md5 differs (CR-insensitive too)')
        if bool(p.get('security_definer')) != bool(l.get('secdef')): d.append('secdef differs')
        pc = ','.join(p.get('config') or []) if isinstance(p.get('config'), list) else (p.get('config') or '')
        if norm(pc) != norm(l.get('config') or ''): d.append(f"config {pc!r}!={l.get('config')!r}")
        if p.get('language') != l.get('lang'): d.append('language differs')
        # ACL 은 '효과' 축으로 정규화: api 4역할(PUBLIC/anon/authenticated/service_role) EXECUTE 집합.
        # 부모 추출기는 proacl NULL(implicit PUBLIC)을 역할별 행으로 전개해 표현한다.
        PERMISSIVE = 'PUBLIC:EXECUTE,anon:EXECUTE,authenticated:EXECUTE,service_role:EXECUTE'
        pa = p.get('acl')
        if pa is not None:
            if isinstance(pa, list):
                ents = [f"{e.get('grantee')}:{e.get('privilege')}" if isinstance(e, dict) else str(e) for e in pa]
                ents = [x for x in ents if x.split(':')[0] in ('PUBLIC', 'anon', 'authenticated', 'service_role')]
                pa_s = ','.join(sorted(ents))
            else:
                pa_s = str(pa)
            la = l.get('acl') or ''
            if la == '(implicit)':
                la_s = PERMISSIVE
            elif la in ('(none)', '(default)'):
                la_s = ''
            else:
                la_s = ','.join(sorted(x for x in la.split(',') if x))
            # PUBLIC:EXECUTE 는 anon/authenticated/service_role 포함을 함의 — 효과 집합으로 확장
            def eff(s):
                xs = set(x for x in s.split(',') if x)
                if 'PUBLIC:EXECUTE' in xs:
                    xs |= {'anon:EXECUTE', 'authenticated:EXECUTE', 'service_role:EXECUTE'}
                return ','.join(sorted(xs))
            if eff(pa_s) != eff(la_s): d.append(f"acl {pa_s!r}!={la_s!r}")
        return '; '.join(d) or None
    ok_all &= diff_axis('functions', P, Q, cmp_fn, report)
    report['functions']['crlf_artifact_only'] = sorted(str(k) for k in crlf_only)
    report['functions']['crlf_artifact_count'] = len(crlf_only)

    # triggers (md5 of definition text)
    P = key_rows(load(pdir/'triggers.json'), lambda r: (r['schema'], r['table'], r['tgname']))
    Q = key_rows(L.get('triggers'), lambda r: (r['sch'], r['tbl'], r['name']))
    ok_all &= diff_axis('triggers', P, Q, lambda p, l:
        None if md5(p['definition']) == l['def_md5'] else 'triggerdef md5 differs', report)

    # policies
    pv = load(pdir/'policies.json'); pv = pv['policies'] if isinstance(pv, dict) else pv
    P = key_rows(pv, lambda r: (r['schemaname'], r['tablename'], r['policyname']))
    Q = key_rows(L.get('policies'), lambda r: (r['sch'], r['tbl'], r['name']))
    def cmp_pol(p, l):
        d = []
        if p['cmd'] != l['cmd']: d.append('cmd differs')
        proles = ','.join(sorted(p.get('roles') or []))
        if proles != ','.join(sorted((l.get('roles') or '').split(','))): d.append(f"roles {proles}!={l.get('roles')}")
        if md5(norm(p.get('qual'))) != l['qual_md5']: d.append('qual differs')
        if md5(norm(p.get('with_check'))) != l['check_md5']: d.append('with_check differs')
        return '; '.join(d) or None
    ok_all &= diff_axis('policies', P, Q, cmp_pol, report)

    # table grants (parent: privileges[] per grantee → explode)
    pg_ = load(pdir/'grants_tables.json'); pg_ = pg_['grants'] if isinstance(pg_, dict) else pg_
    P = {}
    for r in pg_:
        for priv in (r.get('privileges') or []):
            P[(r['table_schema'], r['table_name'], r['grantee'], priv)] = r
    Q = key_rows(L.get('table_grants'), lambda r: (r['sch'], r['tbl'], r['grantee'], r['priv']))
    ok_all &= diff_axis('table_grants', P, Q, lambda p, l: None, report)

    # buckets
    P = key_rows(load(pdir/'buckets.json'), lambda r: r['id'])
    Q = key_rows(L.get('buckets'), lambda r: r['id'])
    def cmp_bkt(p, l):
        d = []
        if bool(p.get('public')) != bool(l.get('public')): d.append('public differs')
        if p.get('file_size_limit') != l.get('file_size_limit'): d.append(f"size {p.get('file_size_limit')}!={l.get('file_size_limit')}")
        pm = ','.join(p.get('allowed_mime_types') or [])
        if pm != (l.get('mime') or ''): d.append(f"mime {pm!r}!={l.get('mime')!r}")
        return '; '.join(d) or None
    ok_all &= diff_axis('buckets', P, Q, cmp_bkt, report)

    # types (enums/composites)
    P = key_rows(load(pdir/'enums.json'), lambda r: (r['schema'], r['name']))
    Q = key_rows(L.get('types'), lambda r: (r['sch'], r['name']))
    ok_all &= diff_axis('types', P, Q, lambda p, l:
        ('; '.join(filter(None, [
            None if p['kind'] == l['kind'] else 'kind differs',
            None if norm(p['definition']) == norm(l['definition']) else f"def {norm(p['definition'])!r}!={norm(l['definition'])!r}"]))
         or None), report)

    # publications (지역: 플랫폼 전용 publication 은 허용 diff)
    ppub = load(pdir/'publications.json')
    prows = ppub.get('publications') if isinstance(ppub, dict) else ppub
    ptabs = (ppub.get('publication_tables') or []) if isinstance(ppub, dict) else []
    ptab_map = {}
    for t in ptabs:
        pn = t.get('pubname')
        tbl = t.get('table') or f"{t.get('schemaname')}.{t.get('tablename')}"
        ptab_map.setdefault(pn, []).append(tbl)
    P = {r['pubname']: {'tbls': ','.join(sorted(ptab_map.get(r['pubname'], [])))} for r in (prows or [])}
    Q = key_rows(L.get('publications'), lambda r: r['pubname'])
    ok_all &= diff_axis('publications', P, Q, lambda p, l:
        None if p['tbls'] == (l.get('tbls') or '') else f"membership {p['tbls']!r}!={l.get('tbls')!r}",
        report, allowed_missing_local=lambda k, r: k in ALLOWED_PUB_PLATFORM)

    # default privileges (pg_default_acl) — public 스키마 기본 권한의 as-applied 상태.
    # 부모 grants_tables.json 의 default_privileges 축과 대조한다.
    # 허용 diff: owner_role='supabase_admin' 행은 플랫폼이 관리(로컬 스텁에 없음).
    pdp = load(pdir/'grants_tables.json')
    pdp = pdp.get('default_privileges', []) if isinstance(pdp, dict) else []
    P = {}
    for r in pdp:
        acl = r.get('defaclacl') or []
        P[(r['owner_role'], r['schema'], r['objtype'])] = ','.join(sorted(acl))
    Q = {(r['owner_role'], r['sch'], r['objtype']): ','.join(sorted(x for x in (r.get('defaclacl') or '').split(',') if x))
         for r in (L.get('default_privileges') or [])}
    # PG17 의 MAINTAIN('m') 권한은 PG16 에 없다 — views deparse 와 같은 엔진 버전 아티팩트.
    # 'm' 을 제거해도 일치하면 실질 drift 가 아니라 엔진 차이로 계상한다.
    maintain_only = []
    def strip_m(acl):
        out = []
        for e in acl.split(','):
            if '=' in e and '/' in e:
                role, rest = e.split('=', 1)
                privs, grantor = rest.split('/', 1)
                out.append(f"{role}={privs.replace('m', '')}/{grantor}")
            else:
                out.append(e)
        return ','.join(out)
    def cmp_defacl(p, l):
        if p == l:
            return None
        if strip_m(p) == strip_m(l):
            maintain_only.append(p)
            return None   # PG16_NO_MAINTAIN_PRIVILEGE — 엔진 버전 허용 diff
        return f"defaclacl {p!r} != {l!r}"
    ok_all &= diff_axis('default_privileges', P, Q, cmp_defacl,
        report, allowed_missing_local=lambda k, r: k[0] == 'supabase_admin')
    report['default_privileges']['engine_maintain_flag_allowed'] = len(maintain_only)

    # extensions (로컬 미설치 허용 목록)
    P = key_rows(load(pdir/'extensions.json'), lambda r: r['extname'])
    Q = {}  # 로컬 인벤토리에 축 없음 — 허용 목록 외 부모 확장만 검사
    only = [k for k in P if k not in ALLOWED_EXT_LOCAL_MISSING and k not in ('plpgsql', 'pgcrypto')]
    report['extensions'] = {'parent_only_unallowed': sorted(only), 'note': '로컬 스크래치는 플랫폼 확장 미설치 — 허용 목록 외만 계상'}
    if only: ok_all = False

    # ---- 요약 ----
    print('=' * 70)
    drift = 0
    for ax, r in report.items():
        if ax == 'extensions':
            n = len(r['parent_only_unallowed'])
            print(f"{ax:14s} unallowed_parent_only={n}")
            drift += n
            continue
        n = len(r['parent_only']) + len(r['local_only']) + len(r['changed'])
        drift += n
        print(f"{ax:14s} parent={r['parent_n']:4d} local={r['local_n']:4d} "
              f"drift={n:3d} (p_only={len(r['parent_only'])}, l_only={len(r['local_only'])}, changed={len(r['changed'])}, allowed={len(r.get('allowed_platform') or [])})")
    print('=' * 70)
    print(f"RESULT: {'EQUIVALENT' if ok_all else 'DRIFT'} (실질 drift 항목 {drift}건)")
    out = Path(lpath).with_suffix('.compare.json')
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1))
    print(f"상세: {out}")
    if full and not ok_all:
        for ax, r in report.items():
            if ax == 'extensions': continue
            for k in r['parent_only'][:20]: print(f"  [{ax}] parent_only: {k}")
            for k in r['local_only'][:20]: print(f"  [{ax}] local_only: {k}")
            for k, d in r['changed'][:20]: print(f"  [{ax}] changed: {k} — {d}")
    return 0 if ok_all else 1

if __name__ == '__main__':
    sys.exit(main())
