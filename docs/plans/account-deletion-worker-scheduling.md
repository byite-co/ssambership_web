# 계정 삭제 worker — 스케줄러 배선 운영 문서 (S3-A)

관련 스펙: `docs/plans/account-deletion-spec.md`
코드: `app/api/cron/account-deletion/route.ts` · `lib/account/accountDeletionCronRoute.ts`
계약 테스트: `lib/account/__contract__/accountDeletionCronRoute.contract.test.ts`

---

## 1. 무엇이 바뀌었나

worker 코드는 이전부터 있었지만 **자동 호출 배선이 없었다**. 이 회차에서:

- `GET /api/cron/account-deletion` 추가 — Vercel Cron 이 호출하는 경로.
- 기존 `POST /api/cron/account-deletion`(수동 운영 경로) 그대로 유지.
- 두 메서드가 동일한 내부 실행 함수 `handleAccountDeletionCron` 을 호출한다.
- `vercel.json` 에 매시간 cron 등록.

**이 회차에서 하지 않은 것:** 운영 배포, 환경변수 실제 변경, 실제 job claim,
실제 삭제. 현재 pending 상태인 실제 overdue job 1건은 **자동으로 처리되지 않는다**
(아래 §5 를 밟기 전까지 러너가 disabled 로 응답하며 claim 0건).

---

## 2. 실행 조건 (전부 참일 때만 실삭제)

| # | 관문 | 어디서 |
|---|------|--------|
| ① | `ACCOUNT_DELETION_WORKER_ENABLED=true` 또는 `1` | `resolveDeletionRunMode` |
| ② | 계정 삭제 기능 플래그 ON (`NEXT_PUBLIC_FEATURE_ACCOUNT_DELETION` 이 off/0/false/no 가 **아님**) | `isAccountDeletionFeatureEnabled` |
| ③ | 명시적 real-run 요청 — GET 은 `ACCOUNT_DELETION_SCHEDULED_REAL_RUN=true\|1`, POST 는 `?dryRun=false` | `resolveRequestedDryRun` |
| ④ | `CRON_SECRET` 인증 성공 (`Authorization: Bearer …` 또는 `x-cron-secret`) | `isAuthorizedCronRequest` |
| ⑤ | 미커버 버킷 0종 | `uncoveredBucketGateBlocks` + 워커 `planBlockReason` |
| ⑥ | claim lease 획득 성공 (154 `account_deletion_claim`) | 어댑터 |

하나라도 어긋나면 **job claim 0건 · Storage 삭제 0 · Auth 삭제 0 · DB 익명화 0**,
응답은 `disabled` 또는 `dryRun: true` 다. 기본값은 언제나 fail-closed.

## 2-1. dry-run zero-write 계약

dry-run 을 "read-only" 라고 부르려면 **DB write 가 실제로 0** 이어야 한다.
`account_deletion_reclaim_expired` 와 `account_deletion_claim` 은 둘 다
`account_deletion_jobs` 를 UPDATE 한다(`lease_owner` · `leased_until` · `updated_at`).
따라서 dry-run 은 이 둘을 **호출하지 않는다**.

| 모드 | preview(SELECT) | reclaim(UPDATE) | claim(UPDATE) | worker | 응답 |
|------|-----------------|-----------------|---------------|--------|------|
| disabled | 0 | 0 | 0 | 0 | `disabled:true` · 실행 카운터 전부 0 |
| dry-run | 1 | **0** | **0** | read-only planner | `dryRun:true` · `claimed:0` · `previewed:N` |
| real-run | 0 | 1 | 1 | 전 단계 | `dryRun:false` · `claimed:N` · `previewed:0` |

dry-run 의 대상 선정은 `previewDeletionJobs`(SELECT)가 담당하며, 154 `account_deletion_claim`
과 **동일한 술어**를 쓴다(`state` ∈ 진행 가능 상태 · `next_attempt_at` 도래 ·
`leased_until` 없음/만료 · `requested_at asc`). 술어가 갈라지면 dry-run 이 real-run 을
예측하지 못하므로, 둘 중 하나를 바꾸면 다른 하나도 함께 바꿔야 한다.

새 RPC·마이그레이션은 만들지 않았다 — 151 이 이미
`grant select, insert, update on public.account_deletion_jobs to service_role` 를 부여하므로
service-role SELECT 로 충분하다.

### 응답 필드 의미

| 필드 | 의미 |
|------|------|
| `claimed` | real-run 이 **lease 를 획득한** job 수 = `claimJobs` 반환 건수. dry-run 은 언제나 `0` |
| `previewed` | dry-run 이 SELECT 로 **조회만** 한 대상 수. real-run 은 언제나 `0` |
| `succeeded` | worker 가 `ok:true` 로 끝낸 수 |
| `stopped` | **예외 없이** `ok:false` 로 중단된 수. 사유는 `results[].stopped` |
| `errored` | worker 가 throw 한 수. 사유 코드는 `errors[]` |
| `failed` | `stopped + errored`. `ok` 는 `failed === 0` 일 때만 `true` |
| `mode` | `worker_disabled` / `feature_disabled` / `dry_run_default` / `dry_run_explicit` / `real_run` |
| `results[].planCount` | 삭제 계획에 담긴 Storage 객체 수(경로는 싣지 않는다) |

**불변식(real-run):**

```
claimed = succeeded + stopped + errored
claimed = succeeded + failed
```

### `stopped` 를 따로 세는 이유

worker 는 실패해도 **던지지 않는 경로가 있다.** 다음은 전부 예외 없이
`{ ok:false, stopped:… }` 로 돌아온다:

`uncovered_buckets` · `ownership_conflict` · `unattributable` · `session_revoke` ·
`residue` · `not_empty` · `CANCEL_WINDOW_OPEN` 이외의 `begin_locked` 실패 코드

`results.length` 를 `succeeded` 로 세면 이들이 **성공으로 집계되고 top-level `ok` 도 `true`**
가 되어, 조용히 멈춘 job 이 정상 완료처럼 보인다. 그래서 `result.ok` 를 반드시 본다.

```
claim 1건 → { ok:false, stopped:'residue' } (throw 없음)
  → { claimed: 1, succeeded: 0, stopped: 1, errored: 0, failed: 1, ok: false }

claim 3건 → ok 1 · stopped 1 · throw 1
  → { claimed: 3, succeeded: 1, stopped: 1, errored: 1, failed: 2, ok: false }
```

`errors[]` 에는 **throw 한 것만** 담긴다. non-throwing 실패는 `results[].ok=false` 와
`results[].stopped` 로 확인한다.

### `claimed` 를 따로 세는 이유

**`claimed` 는 작업 성공 수가 아니다.** worker 가 실패로 끝난 job 도 lease 는 이미 획득한
상태이므로 `claimed` 에 남는다. 부분 실패 시 운영자가 **"몇 건이 lease 를 물고 있는가"**
(재시도·lease 만료 대기 판단)와 **"몇 건이 실제로 진행됐는가"**(진척 판단)를 구분할 수
있어야 한다. `claimed` 를 성공 수로 세면 lease 를 물고 있는 job 이 응답에서 사라진다.

### 왜 스케줄 real-run 스위치를 따로 뒀나

`vercel.json` 의 cron path 는 저장소에 평문으로 남는다. 그 URL 에 `?dryRun=false`
하나만 붙이면 전 사용자 실삭제가 켜지는 구조는 위험하다. 따라서 **scheduled(GET)
경로는 쿼리스트링을 아예 읽지 않는다** — `?dryRun=false` 를 붙여도 무시되고
dry-run 으로 남는다. 스케줄 real-run 스위치는 전용 env
`ACCOUNT_DELETION_SCHEDULED_REAL_RUN` 뿐이며, worker env 와 **분리**돼 있어
"워커를 켜서 스케줄 dry-run 을 관측하는 단계"와 "실제로 지우기 시작하는 단계"가
서로 다른 env 변경으로 나뉜다.

---

## 3. 환경변수

| 이름 | 기본 | 용도 |
|------|------|------|
| `CRON_SECRET` | 없음(미설정 시 **전 요청 401**) | cron 인증. Vercel Cron 이 자동으로 `Authorization: Bearer $CRON_SECRET` 을 붙인다. 기존 cron 2종과 공유. |
| `ACCOUNT_DELETION_WORKER_ENABLED` | 미설정 = off | 워커 kill switch. `true`/`1` 만 인정. |
| `ACCOUNT_DELETION_SCHEDULED_REAL_RUN` | 미설정 = off | **스케줄 실행**의 real-run 스위치. `true`/`1` 만 인정. |
| `NEXT_PUBLIC_FEATURE_ACCOUNT_DELETION` | 미설정 = ON | 기능 플래그. `off`/`0`/`false`/`no` 로 긴급 차단. |
| `SUPABASE_SERVICE_ROLE_KEY` | 필수 | 없으면 500 `server_config`(부분 실행 없음). |

---

## 4. cron 스케줄

```json
{ "path": "/api/cron/account-deletion", "schedule": "0 * * * *" }
```

매시간 정각 1회. `cancelable_until` 이 지난 job 을 늦어도 1시간 안에 집는다.

> **배포 전 확인 필요 — 프로젝트 플랜 UNVERIFIED:** 이 저장소의 Vercel 플랜은
> 현재 세션에서 확인되지 않았고(배포 설정 접근 금지 범위), **추정하지 않는다**.
> Vercel 플랜에 따라 cron 빈도·개수 제한이 다르므로, hourly cron 3번째 항목이
> 현 플랜에서 허용되는지는 **병합 전에 사람이 확인해야 한다**.
> 확인 결과 허용되지 않는다면, 임의 주기로 낮추지 말고 플랜 승급 또는 별도
> 스케줄러(Supabase `pg_cron` → HTTP 호출)를 결정한다. 이 회차에서는 목표 주기인
> hourly 를 그대로 두었다.

기존 cron 2종은 이 회차에서 수정하지 않았다.

---

## 5. 운영 적용 전 검증 순서

각 단계는 **다음 단계로 넘어가기 전에** 응답을 확인한다.

1. **배포만** — env 는 아직 아무것도 켜지 않는다.
   스케줄 GET 이 `{"disabled":true,"reason":"worker_disabled"}` + 실행 카운터 전부 0 으로
   응답하는지 Vercel cron 로그에서 확인. claim 0건이어야 한다.
2. **인증 회귀 확인** — 인증 없는 `GET`/`POST` 가 401 인지 확인.
   (`curl -i https://<host>/api/cron/account-deletion` → 401)
3. **수동 dry-run** — `POST` + `Authorization: Bearer $CRON_SECRET`, 쿼리 없음.
   `dryRun:true`, `mode:"dry_run_default"`, `claimed:0`, `uncoveredBuckets: []` 확인.
   `uncoveredBuckets` 가 비어 있지 않으면 **여기서 멈춘다**(⑤ 관문).
4. **워커 ON, 스케줄은 여전히 dry-run** — `ACCOUNT_DELETION_WORKER_ENABLED=true`.
   `ACCOUNT_DELETION_SCHEDULED_REAL_RUN` 은 **설정하지 않는다**.
   최소 2~3 사이클(2~3시간) 동안 스케줄 GET 응답이
   `mode:"dry_run_default"`, `claimed: 0`, `previewed` ≥ 0, `failed: 0` 인지 관측.
   `failed > 0` 이면 `stopped`(예외 없이 중단)인지 `errored`(throw)인지 나눠 보고,
   `results[].stopped` / `errors[]` 로 사유를 확인한다.
   이 구간에서 계획 산출 결과(`results[].planCount`)가 예상과 맞는지 본다.
   **관측 중 `account_deletion_jobs` 의 `attempts`·`lease_owner`·`leased_until`·`updated_at`
   이 변하지 않아야 한다** — 변한다면 zero-write 계약이 깨진 것이므로 즉시 4를 중단한다.
5. **단건 수동 real-run** — `POST ...?dryRun=false&limit=1`.
   대상 job 1건이 어디까지 진행되는지 확인하고 `account_deletion_jobs` 상태를 검수.
6. **스케줄 real-run 개방** — 5 가 정상일 때만
   `ACCOUNT_DELETION_SCHEDULED_REAL_RUN=true` 설정.
7. **롤백** — 이상 시 `ACCOUNT_DELETION_SCHEDULED_REAL_RUN` 제거(스케줄만 정지) 또는
   `ACCOUNT_DELETION_WORKER_ENABLED` 제거(수동 포함 전면 정지). 둘 다 즉시 fail-closed.

---

## 6. PII 취급

응답과 운영 로그에는 **사용자 uuid · 이메일 · Storage 경로 · job id 를 싣지 않는다.**
개수(`claimed`, `previewed`, `succeeded`, `stopped`, `errored`, `failed`, `planCount`)와
상태명(`finalState`, `results[].stopped`, `mode`)만 남는다.

워커/어댑터 오류 문자열은 원문에 버킷 경로와 uuid 가 섞일 수 있으므로
`sanitizeDeletionCronError` 가 화이트리스트(`^[a-z0-9_]{1,64}$`, 긴 hex 차단)로
**코드만** 통과시키고 나머지는 `job_failed` 로 접는다. 워커의 `log` 어댑터는
라우트에서 **주입하지 않는다**(meta 에 Storage 경로가 실릴 수 있다).

상세 진단이 필요하면 응답이 아니라 DB(`account_deletion_jobs.last_error`)를 본다.

---

## 7. lease 계약 (real-run 에만 적용)

- **real-run** 실행 시작에 `account_deletion_reclaim_expired` 1회 — 죽은 러너가 쥔 lease 회수.
  dry-run 은 회수도 claim 도 하지 않는다(§2-1).
- claim 은 154 `account_deletion_claim`(owner + `leased_until` + `FOR UPDATE SKIP LOCKED`).
  151 `account_deletion_worker_claim` 은 lease 를 다루지 않아 중복 처리가 가능하므로 **쓰지 않는다**.
- 따라서 cron 이 겹쳐 실행돼도 같은 job 을 두 러너가 동시에 집지 않는다.
- 기본 `limit=5`, `leaseSeconds=300`(쿼리로 1~20 / 60~3600 범위 내 조정 가능).
