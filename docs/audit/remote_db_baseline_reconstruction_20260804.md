# remote DB baseline reconstruction — 세션 작업 노트 (정리 전 초안)

> 최종 정본은 web repo `docs/audit/remote_db_baseline_reconstruction_20260804.md` 로 승격.

## 근본 원인 (실측 확정)
- 부모(lbeqxarxothkmzqvpudy) 원장: 56건, 최초 20260702065122.
- 기반 스키마(001~183 번호 SQL + 번들)는 SQL Editor 수동 적용 — 원장 밖.
- 진단 branch(ltktfmgjjdzaxugyoxrg, 삭제 완료): 원장 1번째 항목의
  `alter table public.users …` 가 42P01 로 실패, 적용 0/56, 빈 스키마.
- 실측 중요 사실: **API 생성 branch 는 부모 원장(statements)을 재생**했다
  (실패문 = 원장 1번 항목과 자구 일치). 공식 문서는 Git 통합 경로(repo
  supabase/migrations clone→migrate)만 서술 — API 경로의 원장 사용은
  문서 NOT_COVERED → UNVERIFIED_PLATFORM_BEHAVIOR(실측 근거만 기록).

## 플랫폼 사실 (공식 문서, MCP search_docs)
- `supabase migration repair --status applied <version>`: 추적 테이블만 변경,
  DDL 실행 없음 — backdated version 채택 가능(값 제한 서술 없음).
- branch 과금: 시간당 $0.01344(Micro), 존재 시간 기준, Spend Cap 미적용.
- with_data=false 의 복사 범위: 문서 NOT_COVERED(실측: 데이터·버킷·auth 미복사).
- repair 된 backdated version 이 미래 branch replay 에 포함되는지: NOT_COVERED
  → 채택 후 신규 branch 로 재검증 필요(권장 순서 4단계).

## 재료
- 원장 56본 replay set: /workspace/baseline-work/ledger/replay (md5 전수검증)
  - 19본 = repo 파일과 byte-일치, 37본 = 원장 statements 추출.
- 부모 앱 스키마 인벤토리: /workspace/baseline-work/inventory
- 번들: supabase/bundles/bundle_{1,2,3} = 001~069 순서 통합(빈 DB 세팅용 정본).
- 번호 070~184: 114파일. 원장 소유 번호 쌍둥이(원장 name 기준):
  101,102,103,104,115,116,120,147,148,149,150,151,152,153,154,155,156
  (원장 content md5 ≠ repo 파일 md5 — as-applied 정본은 원장 쪽).

## baseline 구성 전략 (모드 A/B/C 는 candidate SQL 이 아니라 검증 스크립트로 분리)
- baseline 후보 = bundles 1..3 + 번호 070~183(마커·seed·rollback 제외) 순서 적용.
  - 원장 쌍둥이 번호는 **의존성 제공자면 포함**(뒤 번호가 참조) — 원장 replay 가
    같은 내용을 재적용해도 수렴하는지(idempotent) 분류로 사전 점검, 라운드트립으로 확정.
  - 원장 후기 항목(M1/M2/수렴)의 '신규 객체 선점 없음' 사전 게이트 목록은 baseline 에
    절대 포함 금지: shortform_view_events, shortform_view_record_v2,
    community_comment_soft_delete_self, admin_issue_user_warning,
    shortform_posts_protected_guard, account_deletion_request_self_v2,
    account_deletion_request_self_consented_v2 (+분류에서 추가 발견분).
- 184_seed_additional_admin: SEED — baseline 제외(REFERENCE_DATA_CLASSIFICATION 검토).
- 수렴식: baseline + ledger56 == 부모 구조 (구조 비교는 inventory 정규화 축).

## 핵심 발견: 실제 이력은 interleaved — 단일 pre-ledger baseline 로 불가
- add_individual_question_attachment 수명: 원장 s17/v2(7/7, RETURNS uuid, or-replace)
  → 수동 168(그 후, drop + RETURNS jsonb) → 원장 20260803142559(or-replace jsonb).
- 168 을 baseline 에 넣으면 s17 이 42P13, 빼면 20260803142559 가 42P13 → 어느 쪽도 불가.
- 해법: 168 은 baseline 에서 제외하고 **interleaved 원장 항목**(version 20260715000000,
  20260707205436 와 20260717044250 사이)으로 등재. Strategy A 는 baseline 1건 + interleave
  N건의 backdated repair 로 확장된다. 로컬 검증은 replay_order_augmented.txt 로 재현.
- 원장 51본 분석(workflow): 나머지 HIGH 항목의 '쌍둥이'는 전부 timestamped repo 파일
  (baseline 미포함) — pre-gate 정상 통과 예상. LOW 1건(s18 bare create policy)은 1회 재생 안전.
- 분석 정본: /workspace/baseline-work/classify/ledger_analysis.json (51본; 후미 5본은 수동 스캔).

## 최종 수렴 결과 (로컬 scratch PG16, 2026-08-04)
- **CURRENT_SCHEMA_EQUIVALENCE: EQUIVALENT (실질 drift 0건, 13축)**
- 구성: baseline 114단계(번들3 + 보충5 + 번호106) + 증강 재생 61단계(원장 56 verbatim + interleave 5)
  - interleave: 168@20260715000000 · idem제약은 baseline 147직전 배치 · defacl-flip@20260802000000
    · ACL수렴@20260804100000 · 속성수렴@20260804100001 · as-applied 함수본문 32건@20260804100002
- 허용 diff(전부 문서화): 함수 84건 CRLF 아티팩트(SQL Editor CRLF 적용 흔적; CR 제거시 md5 일치,
  functions_md5_nocr.tsv 체크섬 검증), 뷰 7건 PG16↔17 deparse 서식(동일버전 재deparse 로 의미동일 입증
  REAL_DIFF 0), supabase_realtime_messages_publication(플랫폼), 플랫폼 확장 미설치.
- PR60: forward → 15케이스 fullschema fixture PASS → rollback md5 정확 복원(58f0c241…) → reapply PASS.
- 검증 모드: A(빈 DB 순차 적용)=PASS · B(verify-only=비교기 EQUIVALENT, 재적용 없음)=PASS ·
  C(부분 상태 hard-fail=비교기 DRIFT exit1)=PASS(수렴 과정에서 반복 실증).
- 한계: baseline 세트는 end-to-end 재적용 비멱등(NOT_IDEMPOTENT_END_TO_END — 후기 파일이 반환타입을
  drop+create 로 바꿈, 예: 078↔112). 복구는 실패 지점부터 재개(전체 재실행 금지). 파일 단위 가드는 전수 유지.
- out-of-band 실측 복원물: 대시보드 정책 11종(한글명; 2종은 lockdown 게이트용으로 재구성 UNRECOVERABLE 원문),
  002-draft 잔재 컬럼 6 + FK 2, community_posts_status_check, author_idem_key 제약 2(147 이전 필수),
  favorites 제약명 정렬, rls_auto_enable + ensure_rls 이벤트 트리거, defacl hardened 전환(시점 근사).

## 로컬 검증 체계
- scratch PG16 + platform_stub(auth/storage/cron/net/vault/realtime 대역).
  - Docker 데몬 부재 → Supabase 로컬 스택 불가(§8 폴백 조항 적용).
- run_roundtrip.sh: stub → baseline → ledger56 → local_inventory → (PR60 f/b/r).
- 비교기: compare_schema_inventory.py — 부모 inventory vs 로컬 inventory,
  허용 차이(OID·현재값·환경 고유값·플랫폼 내부) 제외.

## 환경 제약 (이 컨테이너)
- *.supabase.co HTTPS/TCP egress 차단(프록시 403) → 실 JWT REST(Auth 가입·Storage
  업로드·Data API) 불가 → PR60 preview 실인증 검증 = BLOCKED_AUTH(§30 규칙).
- MCP(서버측) 경유 SQL/관리작업은 가능 — branch 스키마 재현·PR60 forward/ACL/advisor 는 수행.
