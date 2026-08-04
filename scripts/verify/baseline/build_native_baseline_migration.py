#!/usr/bin/env python3
"""build_native_baseline_migration.py — pre-ledger baseline 을 정식 migration 1본으로 생성.

입력: supabase/baseline/apply_order.txt (114 apply stages)
      각 stage 의 source 파일 bytes (번들은 섹션 단위로 분해되어 188 source parts)
출력: supabase/migrations/20260701000000_pre_ledger_baseline.sql
      supabase/baseline/native_baseline_source_map.tsv
      supabase/baseline/native_baseline_manifest.json

설계 원칙 (지시서 §7):
  * 완전 결정론: 같은 입력 → 어느 OS 에서도 byte 동일 출력.
  * binary I/O 전용. Python universal-newline 변환에 의존하지 않는다.
  * source SQL 의 의미를 바꾸지 않는다 — 재포맷·parser 재작성·정규화·
    transaction 문 제거를 일절 하지 않는다. BOM 만 제거한다(SQL Editor 동작과 동일).
  * source 사이에는 생성기가 정의한 고정 ASCII separator 만 넣는다.
  * 주석 전용 part 도 source map 에 포함한다.
  * 출력 파일을 직접 편집하면 validator 가 헤더의 SHA-256 불일치로 실패한다.

사용: python3 build_native_baseline_migration.py [--check]
  --check 는 파일을 쓰지 않고 현재 산출물이 최신인지만 확인한다(비제로 종료로 실패 보고).
"""
from __future__ import annotations
import hashlib, json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
APPLY_ORDER = REPO / 'supabase/baseline/apply_order.txt'
OUT_SQL = REPO / 'supabase/migrations/20260701000000_pre_ledger_baseline.sql'
OUT_MAP = REPO / 'supabase/baseline/native_baseline_source_map.tsv'
OUT_MANIFEST = REPO / 'supabase/baseline/native_baseline_manifest.json'
GENERATOR_REL = 'scripts/verify/baseline/build_native_baseline_migration.py'

BOM = b'\xef\xbb\xbf'
SECTION_RE = re.compile(rb'^-- ===== ([0-9]{3}[a-z]?_.*\.sql) =====[ \t]*$')
SEP = b'\n-- >>> NATIVE_BASELINE_PART %04d | %s | %s <<<\n'

EXPECT_SOURCE_PARTS = 188
EXPECT_EXECUTABLE = 185
EXPECT_COMMENT_ONLY = 3
EXPECT_STAGES = 114


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def is_comment_only(body: bytes) -> bool:
    for line in body.split(b'\n'):
        s = line.strip()
        if s and not s.startswith(b'--'):
            return False
    return True


def collect_parts():
    """apply_order 를 188 source part 로 분해한다(번들은 섹션 경계로 나눈다)."""
    stages = [l.strip() for l in APPLY_ORDER.read_text(encoding='utf-8').splitlines() if l.strip()]
    parts = []
    for stage_no, rel in enumerate(stages, start=1):
        raw = (REPO / rel).read_bytes()
        if raw.startswith(BOM):
            raw = raw[len(BOM):]
        raw = raw.replace(BOM, b'')
        if '/bundles/' in rel:
            lines = raw.split(b'\n')
            idx = [i for i, l in enumerate(lines) if SECTION_RE.match(l)]
            bounds = [0] + idx + [len(lines)]
            for j in range(len(bounds) - 1):
                chunk = b'\n'.join(lines[bounds[j]:bounds[j + 1]])
                if j == 0:
                    name = 'preamble'
                else:
                    m = SECTION_RE.match(lines[idx[j - 1]])
                    name = m.group(1).decode()
                parts.append({'stage': stage_no, 'source_path': rel, 'section': name, 'body': chunk})
        else:
            parts.append({'stage': stage_no, 'source_path': rel,
                          'section': Path(rel).name, 'body': raw})
    return stages, parts


def build():
    stages, parts = collect_parts()
    if len(stages) != EXPECT_STAGES:
        sys.exit(f'FAIL: apply stages {len(stages)} != {EXPECT_STAGES}')
    if len(parts) != EXPECT_SOURCE_PARTS:
        sys.exit(f'FAIL: source parts {len(parts)} != {EXPECT_SOURCE_PARTS}')

    comment_only = [p for p in parts if is_comment_only(p['body'])]
    executable = len(parts) - len(comment_only)
    if len(comment_only) != EXPECT_COMMENT_ONLY or executable != EXPECT_EXECUTABLE:
        sys.exit(f'FAIL: executable {executable}/{EXPECT_EXECUTABLE}, '
                 f'comment-only {len(comment_only)}/{EXPECT_COMMENT_ONLY}')

    apply_order_sha = sha256(APPLY_ORDER.read_bytes())
    # source manifest: part 순서 + 경로 + 섹션 + body sha 를 고정 문자열로 직렬화해 해시
    src_manifest_lines = [
        f"{i:04d}\t{p['stage']}\t{p['source_path']}\t{p['section']}\t{sha256(p['body'])}"
        for i, p in enumerate(parts, start=1)]
    source_manifest_sha = sha256('\n'.join(src_manifest_lines).encode())

    # 본문 조립 (헤더는 content sha 계산 후 앞에 붙인다)
    body_buf = bytearray()
    rows = []
    for i, p in enumerate(parts, start=1):
        kind = 'comment_only' if is_comment_only(p['body']) else 'executable'
        sep = SEP % (i, p['source_path'].encode(), p['section'].encode())
        body_buf += sep
        start_byte = len(body_buf)
        start_line = body_buf.count(b'\n') + 1
        body_buf += p['body']
        if not body_buf.endswith(b'\n'):
            body_buf += b'\n'
        rows.append({
            'order': i, 'stage': p['stage'], 'part_id': f'part{i:04d}', 'kind': kind,
            'source_path': p['source_path'], 'section': p['section'],
            'source_sha256': sha256(p['body']), 'source_size': len(p['body']),
            'output_start_byte': start_byte, 'output_end_byte': len(body_buf),
            'output_start_line': start_line, 'output_end_line': body_buf.count(b'\n'),
        })
    content = bytes(body_buf)
    content_sha = sha256(content)

    header = (
        "-- 20260701000000_pre_ledger_baseline.sql\n"
        "-- GENERATED_FILE: YES\n"
        "-- DO_NOT_EDIT_DIRECTLY: 이 파일은 생성기 산출물이다. 직접 수정하면 validator 가 실패한다.\n"
        f"-- GENERATOR_PATH: {GENERATOR_REL}\n"
        f"-- SOURCE_PARTS: {EXPECT_SOURCE_PARTS}\n"
        f"-- EXECUTABLE_PARTS: {executable}\n"
        f"-- COMMENT_ONLY_PARTS: {len(comment_only)}\n"
        f"-- APPLY_STAGES: {len(stages)}\n"
        f"-- APPLY_ORDER_SHA256: {apply_order_sha}\n"
        f"-- SOURCE_MANIFEST_SHA256: {source_manifest_sha}\n"
        f"-- GENERATED_CONTENT_SHA256: {content_sha}\n"
        "--\n"
        "-- ⚠️ BASELINE_ATOMICITY: NOT_GUARANTEED\n"
        "--    원본 source 안에 자체 BEGIN/COMMIT 쌍이 다수 존재한다. 이 파일을 하나의\n"
        "--    트랜잭션으로 감싸 실행해도 내부 COMMIT 이 바깥 트랜잭션을 끊으므로 전체\n"
        "--    원자성은 성립하지 않는다. 적용 도중 실패하면 부분 상태가 남는다.\n"
        "-- ⚠️ BASELINE_FAILURE_RECOVERY: DISCARD_FRESH_DATABASE_AND_RECREATE\n"
        "-- ⚠️ BASELINE_SAME_DB_RETRY: PROHIBITED — 같은 DB 에서 재실행·resume 하지 않는다.\n"
        "\n"
    ).encode()

    out_bytes = header + content
    manifest = {
        'generator': GENERATOR_REL,
        'output_path': str(OUT_SQL.relative_to(REPO)),
        'apply_order_sha256': apply_order_sha,
        'source_manifest_sha256': source_manifest_sha,
        'generated_content_sha256': content_sha,
        'output_sha256': sha256(out_bytes),
        'output_size': len(out_bytes),
        'source_parts': EXPECT_SOURCE_PARTS,
        'executable_parts': executable,
        'comment_only_parts': len(comment_only),
        'apply_stages': len(stages),
        'atomicity': 'NOT_GUARANTEED',
        'failure_recovery': 'DISCARD_FRESH_DATABASE_AND_RECREATE',
        'same_db_retry': 'PROHIBITED',
    }
    cols = ['order', 'stage', 'part_id', 'kind', 'source_path', 'section', 'source_sha256',
            'source_size', 'output_start_byte', 'output_end_byte', 'output_start_line',
            'output_end_line']
    map_text = '\t'.join(cols) + '\n' + '\n'.join(
        '\t'.join(str(r[c]) for c in cols) for r in rows) + '\n'
    return out_bytes, map_text.encode(), (json.dumps(manifest, indent=1, sort_keys=True) + '\n').encode()


def main():
    check = '--check' in sys.argv
    out_sql, out_map, out_manifest = build()
    targets = [(OUT_SQL, out_sql), (OUT_MAP, out_map), (OUT_MANIFEST, out_manifest)]
    if check:
        bad = [str(p.relative_to(REPO)) for p, b in targets
               if not p.exists() or p.read_bytes() != b]
        if bad:
            print('BASELINE_GENERATOR_CHECK: FAIL (stale/edited): ' + ', '.join(bad))
            return 1
        print('BASELINE_GENERATOR_CHECK: PASS')
        return 0
    for p, b in targets:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b)
    print(f'wrote {OUT_SQL.relative_to(REPO)}  bytes={len(out_sql)}  sha256={sha256(out_sql)}')
    print(f'wrote {OUT_MAP.relative_to(REPO)}')
    print(f'wrote {OUT_MANIFEST.relative_to(REPO)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
