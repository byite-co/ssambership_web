// 계정 삭제 — 버킷별 "사용자 소유 객체" 수집 전략표(순수 모듈, 부수효과·SDK 의존 0).
//
// 왜 별도 파일인가: 계약 테스트 러너(`node --test --experimental-strip-types`)는 tsconfig 의
// `@/*` alias 를 해석하지 못한다. 어댑터(`server-only`)에서 이 표를 분리해 두면
// 테스트가 상대경로로 직접 가져와 커버리지 계산을 고정할 수 있다.
//
// ── W5 §3-3 실측 근거(staging lbeqxarxothkmzqvpudy, 2026-07-26) ──────────────────────
// 구 구현은 `{userId}/` prefix 스캔뿐이라 사용자 uuid 로 키잉된 2개 버킷에서만 결과가 나왔고,
// 나머지는 질문/글/주문 uuid 로 키잉되어 **공허하게 빈 인벤토리**를 돌려주고 있었다.
// 아래 표는 각 버킷의 소유자를 되짚는 DB 조인 경로를 실제 컬럼으로 확정한 것이다.
//
// ★ 한계(숨기지 않는다): DB 조인은 **등록 행이 있는 객체만** 찾는다. 업로드는 됐지만
//   등록 RPC 가 실패한 orphan 은, 사용자 prefix 로도 키잉되지 않는 버킷에서는 이 경로로
//   찾히지 않는다. prefix 커버 버킷(아래 5종)만이 orphan 까지 포함해 완전하다.
//   기존 orphan 정리는 이번 회차 범위 밖이다(지시서 §0).
//
// ── W5-c §3-3 owner_id 채움률 실측(staging, 2026-07-26, 13버킷 전수) ────────────────
//   bucket                                   objects  with_owner  null_owner
//   community-post-images                        64        64         0
//   connection-note-ink                           0         0         0
//   custom-order-deliverables                     2         2         0
//   custom-order-message-attachments              0         0         0
//   custom-request-application-attachments        2         2         0
//   custom-request-post-attachments               2         2         0
//   individual-question-attachments               5         0         5   ← 등록 RPC 경유(owner 미기록)
//   profile-avatars                               1         1         0
//   question-room-attachments                     7         7         0
//   scan-annotations                              0         0         0
//   shortform-thumbnails                          0         0         0
//   shortform-videos                              0         0         0
//   student-id-images                             1         1         0
//
//   → with_owner > 0 버킷 존재 = 지시서 §3-3 **(b) 분기**. 수집은
//     DB 조인 refs ∪ owner_id=대상(전 버킷) ∪ prefix ∪ 유저-스코프 전 버킷 인벤토리로
//     확장되고(classifyDeletionPlan), OWNERSHIP_CONFLICT / UNATTRIBUTABLE ≥ 1 이면
//     미커버 버킷과 동일 관문에서 real-run 시작 0 · storage_purged 전이 0 이다.
//     owner 부재(null)는 충돌 신호가 아니다 — individual-question-attachments 실측이
//     보여주듯 정상 등록 경로도 owner 를 남기지 않는다(DB 조인이 소유의 정본).
//   ★ owner 증거의 런타임 소스 실측: storage 스키마는 PostgREST 미노출(PGRST106) —
//     증거를 읽지 못하는 동안 워커는 fail-closed 로 정지한다. 상세는
//     accountDeletionAdapters.makeGatherOwnerEvidence 주석.

/** 소유자 컬럼을 **직접** 가진 (버킷, 테이블, 소유자 컬럼, 경로 컬럼) 매핑. */
export type DbRefSource = {
  bucket: string;
  table: string;
  ownerColumn: string;
  /** 경로/참조 문자열 컬럼. text[] 컬럼도 허용(정규화 단계에서 평탄화). */
  pathColumns: readonly string[];
};

/**
 * 이 프로젝트가 실제로 보유한 Storage 버킷 전수(staging `storage.buckets` 실조회 13종).
 * 여기 있는데 아래 어느 전략에도 걸리지 않으면 `computeUncoveredBuckets` 가 잡아내고
 * 워커가 real-run 을 거부한다 — 조용한 미삭제를 구조적으로 막는다.
 */
export const ACCOUNT_DELETION_ALL_BUCKETS: readonly string[] = [
  "community-post-images",
  "connection-note-ink",
  "custom-order-deliverables",
  "custom-order-message-attachments",
  "custom-request-application-attachments",
  "custom-request-post-attachments",
  "individual-question-attachments",
  "profile-avatars",
  "question-room-attachments",
  "scan-annotations",
  "shortform-thumbnails",
  "shortform-videos",
  "student-id-images",
];

/**
 * 객체 키 첫 세그먼트가 **사용자 uuid** 인 버킷 — prefix 스캔으로 orphan 까지 잡힌다.
 * 실측 경로 규칙:
 *   student-id-images        `{uid}/…`(+ school-verifications·academic-record-changes 하위)
 *   profile-avatars          `{uid}/{uuid}.{ext}`
 *   community-post-images    `{uid}/{uuid}-{safeName}.{ext}`  (communityImageRef)
 *   shortform-videos         `{uid}/{uuid}.{ext}`             (shortformVideoRef)
 *   shortform-thumbnails     `{uid}/{uuid}-thumb.{ext}`       (communityShortformStorage)
 */
export const ACCOUNT_DELETION_PREFIX_BUCKETS: readonly string[] = [
  "student-id-images",
  "profile-avatars",
  "community-post-images",
  "shortform-videos",
  "shortform-thumbnails",
];

/**
 * 소유자 조인 경로. 각 항목은 "그 사용자 본인이 올린/소유한" 행만 고르는 술어여야 한다 —
 * 과삭제는 미삭제보다 나쁘다(§3-3 계약 5).
 *
 * `individual-question-attachments` 는 업로더 컬럼이 없어 2단계 조인이 필요하므로
 * 이 표가 아니라 어댑터의 전용 수집기가 담당한다(그래도 커버리지 계산에는 포함된다).
 */
export const ACCOUNT_DELETION_DB_REF_SOURCES: readonly DbRefSource[] = [
  // 질문방 첨부 — 테이블에 author_id 가 직접 있다.
  {
    bucket: "question-room-attachments",
    table: "question_attachments",
    ownerColumn: "author_id",
    pathColumns: ["storage_path"],
  },
  // 맞춤의뢰 등록 첨부 / 지원 첨부 / 주문 메시지 첨부 — 업로더 컬럼 보유.
  {
    bucket: "custom-request-post-attachments",
    table: "custom_request_post_attachments",
    ownerColumn: "uploaded_by",
    pathColumns: ["storage_path"],
  },
  {
    bucket: "custom-request-application-attachments",
    table: "custom_request_application_attachments",
    ownerColumn: "uploaded_by",
    pathColumns: ["storage_path"],
  },
  {
    bucket: "custom-order-message-attachments",
    table: "custom_order_message_attachments",
    ownerColumn: "uploader_id",
    pathColumns: ["storage_path"],
  },
  // 납품물 — 업로더는 멘토다(custom_order_deliverables.mentor_id).
  {
    bucket: "custom-order-deliverables",
    table: "custom_order_deliverables",
    ownerColumn: "mentor_id",
    pathColumns: ["storage_path"],
  },
  // 연결노트 잉크 — 작성자 본인 소유.
  {
    bucket: "connection-note-ink",
    table: "connection_notes",
    ownerColumn: "author_id",
    pathColumns: ["ink_path", "ink_thumb_path"],
  },
  // 스캔 주석 — 작성자 본인 소유(구 목록 어디에도 없던 버킷. §3-3 에서 새로 편입).
  {
    bucket: "scan-annotations",
    table: "scan_annotations",
    ownerColumn: "author_id",
    pathColumns: ["scan_image_path", "preview_path"],
  },
  // 아래 3종은 prefix 로도 잡히지만, 참조가 DB 에만 남은 경우(경로 규칙 이전 데이터)를
  // 위해 조인도 함께 건다. 합집합·dedup 이므로 중복은 무해하다.
  {
    bucket: "community-post-images",
    table: "community_posts",
    ownerColumn: "author_id",
    pathColumns: ["image_urls"],
  },
  {
    bucket: "shortform-videos",
    table: "shortform_posts",
    ownerColumn: "author_id",
    pathColumns: ["video_url"],
  },
  {
    bucket: "shortform-thumbnails",
    table: "shortform_posts",
    ownerColumn: "author_id",
    pathColumns: ["thumbnail_url"],
  },
];

/**
 * 전용 수집기가 담당하는 버킷(표로 표현할 수 없는 다단 조인).
 *   individual-question-attachments:
 *     message_id → individual_question_messages.author_id,
 *     message_id IS NULL → question_id → individual_questions.student_id
 */
export const ACCOUNT_DELETION_JOINED_BUCKETS: readonly string[] = [
  "individual-question-attachments",
];

/**
 * 소유자 판별 경로가 **없는** 버킷 — 추측 규칙으로 삭제 대상에 넣지 않는다(§3-3 계약 3).
 * 현재 전수 실측 결과 해당 없음(0종). 비어 있지 않게 되면 워커가 real-run 을 거부한다.
 */
export const ACCOUNT_DELETION_UNDETERMINABLE_BUCKETS: readonly string[] = [];

/**
 * 미커버 = 전 버킷 − (prefix 커버 ∪ DB 조인 커버 ∪ 전용 수집기 커버) + 판별불가 선언분.
 * 하드코딩 목록이 아니라 계산값이라, 전략 없는 버킷이 추가되면 자동으로 게이트가 닫힌다.
 */
export function computeUncoveredBuckets(input: {
  all: readonly string[];
  prefixBuckets: readonly string[];
  sources: readonly DbRefSource[];
  undeterminable: readonly string[];
  joinedBuckets?: readonly string[];
}): string[] {
  const covered = new Set<string>([
    ...input.prefixBuckets,
    ...input.sources.map((s) => s.bucket),
    ...(input.joinedBuckets ?? ACCOUNT_DELETION_JOINED_BUCKETS),
  ]);
  const undeterminable = new Set(input.undeterminable);
  const out = new Set<string>();
  for (const bucket of input.all) {
    if (undeterminable.has(bucket) || !covered.has(bucket)) out.add(bucket);
  }
  for (const bucket of input.undeterminable) out.add(bucket);
  return [...out].sort();
}

/** 현재 배선의 미커버 목록(계산값). 러너 응답·워커 게이트가 같은 값을 본다. */
export const ACCOUNT_DELETION_UNCOVERED_BUCKETS: readonly string[] = computeUncoveredBuckets({
  all: ACCOUNT_DELETION_ALL_BUCKETS,
  prefixBuckets: ACCOUNT_DELETION_PREFIX_BUCKETS,
  sources: ACCOUNT_DELETION_DB_REF_SOURCES,
  undeterminable: ACCOUNT_DELETION_UNDETERMINABLE_BUCKETS,
});
