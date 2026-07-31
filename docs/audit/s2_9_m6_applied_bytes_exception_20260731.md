# S2-9 / 최종 R0~R7 실행 — M6 적용 바이트 편차 오너 예외 승인 기록

작성일: 2026-07-31 (UTC) · 세션: 최종 R0~R7 실행 (승인 문구 "R0 실행 승인" 09:39:29 UTC 접수 · 4시간 운영 창)
대상 project: `lbeqxarxothkmzqvpudy` (ssambership-staging — 운영 단일 DB) · DB artifact source: RC `0685b231f1729db72345eea0340e1fc7a1e9ca49`

> 본 문서는 M6(`20260730105248_api_web_v1_self_rpc`) 적용 시 발생한 6자 전사 편차에 대한
> **이번 rollout 한정 오너 예외 승인**의 정본 기록이다. migration ledger 의 수정·삭제·repair,
> M6 rollback·재적용은 본 예외 승인과 무관하게 계속 금지된다.

---

## 1. 대상 식별

| 항목 | 값 |
|---|---|
| migration 파일 | `supabase/sql/20260730105248_api_web_v1_self_rpc.sql` (S2 M6) |
| ledger version | `20260731102007` (Supabase MCP `apply_migration` 이 적용 시각으로 채번 — S2 8행 공통 방식) |
| ledger name | `20260730105248_api_web_v1_self_rpc` (파일 stem 정확 일치 — 계약 §7 공통 규칙 충족) |

## 2. 정본·적용문 해시 대조 (예외 기록 필수 항목 ①~③)

| 항목 | RC blob 정본 | ledger 저장 적용문 | 차이 |
|---|---|---|---|
| SHA-256 | `0066357d68dcb3ffcf2fb386ddd5ae1d05db88870146f71a780f0169ceb85a98` | `d640e5bd1ce1d143ca1d7130cf3998925a23603664b2f47c7b204d158f950de3` | — |
| MD5 | `63e318534a4cf2ffe50d092b94fed375` | `378f65e348c0b2d6e650a0567396c63e` | — |
| byte length | 19,061 | 19,067 | **+6 bytes** |
| char length | 17,737 | 17,743 | **+6 chars** |

정본 SHA-256 은 S2-2 rollout plan §2.1 정본표와 일치함을 적용 직전·판정 시 2회 재실측했다.

## 3. 정확한 diff 3개소 (필수 항목 ④)

전부 §I 「적용 직후 자가 검증」 DO 블록 내 `(identity_arguments, proname) IN (...)` 리스트.
ledger 적용문 문자 위치 기준:

| # | char 위치 | 정본 | 적용문 |
|---|---|---|---|
| 1 | 17,234 | `('', 'account_deletion_status_self'),` | `(('', 'account_deletion_status_self')),` |
| 2 | 17,284 | `('', 'my_subscriptions_self'),` | `(('', 'my_subscriptions_self')),` |
| 3 | 17,327 | `('', 'mentor_settlement_self'));` | `(('', 'mentor_settlement_self')));` |

**유일성 증명:** ledger 적용문에서 위 3개 부분문자열만 정본형으로 치환하면
md5 = `63e318534a4cf2ffe50d092b94fed375`(RC blob 과 동일)·17,737 chars·19,061 bytes 로 완전
수렴하고, regexp 편차 카운트 = 정확히 3. 즉 DDL·함수 본문·GRANT·REVOKE·COMMENT 구간은
바이트 동일하며 편차는 이 6자가 전부다.

## 4. 기능·상태 영향 0 증거 (필수 항목 ⑤)

- 여분 괄호는 SQL row-value 의 중복 괄호로 **의미 동일**(파서 등가). 해당 DO 블록은 검증
  전용으로 **상태 변경 0** — 적용 당시에도 6/6 매칭으로 통과했다.
- 적용 직후 독립 재검증(read-only SELECT): `api_web_v1` 함수 정확히 6종 — 전건 SECURITY
  DEFINER·`search_path=''`·anon EXECUTE 0·authenticated/service_role EXECUTE 부여·PUBLIC
  ACL 항목 0·identity arguments 정본 일치. view 5종·`core_private` F10 1종(외부 EXECUTE 0) 불변.
- 오너 판정 후 재실행한 **정본형(괄호 편차 없는) 판정식 SELECT** 도 6/6 매칭 — 편차로 인한
  FAIL 발생 없음.
- `sql_number_integrity.mjs` 재실행 PASS (legacy 190·제외 15·forward 17·rollback 16·정규
  clean-install 192). HEAD `0442ce63` 불변·제품 트리 clean.
- S2 batch verifier(`s2_2_batch_*_verify.sql`)는 local-only 가드·fixture DML 내장 설계로
  원격 실행이 금지 범위 — 원격 판정은 위 read-only 동등 판정식으로 수행했다.

## 5. 발생 원인 (필수 항목 ⑥)

적용 러너(Claude Code 세션)가 RC blob 원문을 `apply_migration` 호출 본문으로 **수동
전사하는 과정에서** §I 리스트 3행에 괄호 1쌍씩을 추가 입력했다. 도구 체인 특성상 SQL 이
모델 컨텍스트를 경유했고, 전사 후 바이트 대조를 **적용 이후에** 수행한 것이 원인이다.

## 6. 향후 방지 (필수 항목 ⑦ — 이번 rollout 잔여 구간 즉시 적용)

1. 모든 후속 migration(M7·M17·M8·M14·M9·M11·M12 등)은 RC git blob 을 직접
   `apply_migration` 에 전달하는 것을 원칙으로 하고 **수동 재입력을 금지**한다.
2. 운영 절차로 강제: 각 apply 직후 **ledger 저장 적용문 md5 ↔ RC blob md5 대조를 즉시
   수행**하고, 불일치 시 후속 단계 진행을 중단하고 오너에 보고한다(이번 M6 감사와 동일
   판정식 — 사후 아님, 단계 게이트로 편입).

## 7. 오너 승인 판정 (2026-07-31 — 이번 rollout 한정)

```
REPOSITORY_CANON_SHA:              PASS
APPLIED_BYTES_MATCH:               PARTIAL_ACCEPTED_EXCEPTION_7_OF_8
M6_APPLIED_BYTES_MATCH:            FAIL_ACCEPTED_OWNER_EXCEPTION
MIGRATION_LEDGER_STRUCTURE:        PASS
MIGRATION_LEDGER_CONTENT:          PARTIAL_ACCEPTED_EXCEPTION
M6_FUNCTIONAL_STATE:               PASS
FINAL_STATE_VERIFIER_CANON:        PASS_REPOSITORY_AND_STATE
```

승인 근거(오너 원문 요지): 편차는 상태 변경 없는 자가검증 DO 블록 3개소·중복 괄호 6자에
국한 · DDL/함수 본문/VIEW/GRANT/SECDEF/search_path 구간 정본 동일 · 원격 최종 상태와
read-only 검증 전건 PASS · rollback 후 재적용은 기능 이익 없이 rollback ledger 행과 동명
forward 행을 추가해 감사 복잡도만 상승 · ledger 수정·삭제·repair 는 계속 금지.

**금지 유지:** M6 rollback 금지 · M6 재적용 금지 · ledger 수정·삭제 금지 · repair migration
작성 금지 · `execute_sql` 우회 금지.

**효력:** 본 예외 승인으로 R1 DB 체인(M0·M15·M1·MC·M13·M4·M5·M6)의 HOLD 를 해제한다.
단, **R1 전체 완료 선언은 D-API-W 저장·런타임 검증·W1 배포·15분 관찰 통과 이후**에만 한다.
