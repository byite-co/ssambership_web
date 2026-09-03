// 계약 테스트: 관리자 상태 사전 ↔ DB CHECK 제약 일치(PR-1 §3).
// 실행: node --test --experimental-strip-types lib/admin/__contract__/adminStatusDictionary.contract.test.ts
//
// 픽스처: 데이터 정본 §4 의 CHECK 값 집합. 저장소 안의 두 정본으로 교차 검증한다 —
//   (a) 원격 DB 인벤토리 스냅샷 docs/audit/remote_db_inventory_20260804/constraints.json (pg_get_constraintdef 원문)
//   (b) 마이그레이션 SQL(supabase/migrations) 의 마지막 `constraint <name> check (...)` 정의
// 인벤토리(08-04) 이후 추가된 app_notices.display_mode 는 (b) 로만 검증한다.
//
// 고정하는 것:
//   ① 사전의 모든 [table.column] 값 집합 == 픽스처(양방향, 누락·초과 모두 실패)
//   ② 픽스처 == 인벤토리/마이그레이션에서 추출한 값 집합(픽스처 자체의 드리프트 방지)
//   ③ payments.status 성공 동의어 5종 → "결제 완료" 하나 · mentor_profiles.verification_status 는 CHECK 없음 → 사전이 유일 허용 목록
//   ④ resolveAdminStatus 는 미등재 값·이상 입력에서 throw 하지 않고 neutral + 원시 값
//   ⑤ AdminStatusPill 은 사전을 경유하고 DS StatusBadge 로 그린다(소스 tripwire)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_STATUS_DICTIONARY,
  ADMIN_STATUS_DICTIONARY_KEYS,
  ADMIN_STATUS_TONES,
  PAYMENT_SUCCEEDED_SYNONYMS,
  adminStatusAllowedValues,
  resolveAdminStatus,
} from "../adminStatusDictionary.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const BASELINE = "supabase/migrations/20260701000000_pre_ledger_baseline.sql";
const SQL_120 = "supabase/migrations/20260717125606_120_admin_console_fixes.sql";
const SQL_USERS_LOCKDOWN = "supabase/migrations/20260803170552_20260803162257_security_identity_profile_lockdown.sql";
const SQL_DISPLAY_MODE = "supabase/migrations/20260830140804_add_display_mode_to_app_notices.sql";
const INVENTORY = "docs/audit/remote_db_inventory_20260804/constraints.json";

/**
 * 데이터 정본 §4 — DB CHECK 값 집합(픽스처).
 * `constraint` 가 있으면 마이그레이션 SQL 의 이름 있는 제약, 없으면 create table 인라인 CHECK(인벤토리로만 검증).
 */
const FIXTURE: Record<
  string,
  { values: string[]; constraint?: { name: string; file: string }; inventory: boolean }
> = {
  "payments.status": {
    values: ["pending", "processing", "succeeded", "failed", "canceled", "refunded", "paid", "success", "complete", "captured"],
    inventory: true,
  },
  "mentor_profiles.verification_status": {
    // CHECK 없음 — 지시서 §3 허용 목록. PR-2 정합: 재제출 값은 코드가 쓰는 under_review(resubmit_required 는 이 컬럼 미사용 → 제거)
    values: ["pending", "approved", "rejected", "under_review", "unsubmitted"],
    inventory: false,
  },
  "disputes.status": {
    values: ["open", "under_review", "resolved", "dismissed", "escalated", "on_hold", "sanction_7d", "sanction_30d", "sanction_permanent"],
    constraint: { name: "disputes_status_check", file: SQL_120 },
    inventory: true,
  },
  "subscriptions.status": {
    values: ["pending", "active", "past_due", "cancel_scheduled", "canceled", "expired", "refunded"],
    constraint: { name: "subscriptions_status_check", file: BASELINE },
    inventory: true,
  },
  "refunds.status": {
    values: ["pending", "succeeded", "rejected", "canceled"],
    inventory: true,
  },
  "content_reports.status": {
    values: ["pending", "reviewing", "resolved", "rejected", "dismissed", "hidden", "removed"],
    constraint: { name: "content_reports_status_allowed", file: SQL_120 },
    inventory: true,
  },
  "individual_questions.status": {
    values: ["escrowed", "assigned", "open", "claimed", "answered", "released", "expired", "refunded", "canceled"],
    inventory: true,
  },
  "question_threads.status": {
    // PR-8 등재 — 관리자 질문 드릴다운. baseline 032(주간 질문 한도 P0)의 이름 있는 제약.
    values: ["pending", "answered", "confirmed", "open", "closed", "archived"],
    constraint: { name: "question_threads_status_check", file: BASELINE },
    inventory: true,
  },
  "question_threads.mastery_status": {
    // PR-8 등재 — 오답노트·숙달 배지.
    values: ["unknown", "wrong", "review", "mastered"],
    constraint: { name: "question_threads_mastery_status_check", file: BASELINE },
    inventory: true,
  },
  "mentor_academic_record_change_requests.status": {
    // create table 인라인 CHECK(baseline 089) — 인벤토리로만 검증. PR-5 후속 등재(오너 확정).
    values: ["pending", "approved", "rejected", "resubmit_required"],
    inventory: true,
  },
  "custom_request_orders.status": {
    // CHECK 없음(4종 동의어 컬럼 — §8-3 정리 전) — 코드가 쓰는 값(관리자 집계 8종)만 등재. PR-5 후속(오너 확정).
    values: ["pending", "open", "delivered", "revision_requested", "completed", "disputed", "cancelled", "refunded"],
    inventory: false,
  },
  "mentor_school_verifications.status": {
    values: ["pending", "approved", "rejected", "resubmit_required", "superseded"],
    constraint: { name: "mentor_school_verifications_status_check", file: BASELINE },
    inventory: true,
  },
  "mentor_school_verifications.school_tier": {
    values: ["서연고", "서성한", "중경외시", "건동홍", "그외", "미분류"],
    constraint: { name: "mentor_school_verifications_school_tier_check", file: BASELINE },
    inventory: true,
  },
  "mentor_school_verifications.verified_major_category": {
    // create table 인라인 CHECK — 인벤토리로만 검증
    values: ["메디컬", "교육", "인문", "사회상경", "자연", "공학", "예체능", "기타"],
    inventory: true,
  },
  "users.status": {
    values: ["active", "suspended", "banned", "deleted"],
    constraint: { name: "users_status_allowed", file: SQL_USERS_LOCKDOWN },
    inventory: true,
  },
  "app_notices.type": {
    values: ["notice", "event", "maintenance", "update"],
    constraint: { name: "app_notices_type_allowed", file: BASELINE },
    inventory: true,
  },
  "app_notices.display_mode": {
    values: ["page", "popup"],
    constraint: { name: "app_notices_display_mode_allowed", file: SQL_DISPLAY_MODE },
    inventory: false, // 08-04 인벤토리 이후(08-30) 추가
  },
  "app_notices.target": {
    // CHECK 없음(baseline `target text null`) · 현행 행 전부 NULL. 구 코드는 자유 문자열 입력뿐이고 읽는 곳이 없었다 → PR-10 부터 사전이 유일 허용 목록(노출 대상 역할 3값).
    values: ["all", "student", "mentor"],
    inventory: false,
  },
  "paysync_invoices.status": {
    // PR-9 충전 관리 — 08-30 신설 테이블의 create table 인라인 CHECK. 인벤토리(08-04)에 없고 이름 있는 제약도 아니라 아래 전용 테스트가 SQL 원문으로 대조한다.
    values: ["pending", "paid", "expired", "canceled"],
    inventory: false,
  },
  "payout_runs.status": {
    // PR-9 정산 지급 이력 — baseline 106 create table 인라인 CHECK(인벤토리 payout_runs_status_check).
    values: ["executing", "completed"],
    inventory: true,
  },
};

const sorted = (xs: Iterable<string>) => [...xs].sort();

/** `'a'`, `'a'::text` 형태의 문자열 리터럴만 뽑는다 */
function quotedLiterals(sqlFragment: string): string[] {
  return [...sqlFragment.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

/** 여는 괄호 위치에서 짝이 맞는 닫는 괄호까지의 내용 */
function balancedParens(text: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  throw new Error("unbalanced parens");
}

/** 마이그레이션 SQL 에서 `constraint <name> check (...)` 의 **마지막** 정의 값 집합 */
function checkValuesFromMigration(file: string, constraintName: string): string[] {
  // 주석(-- …)은 걷어낸다 — 롤백 안내로 주석 처리된 옛 정의가 "마지막" 으로 잡히지 않게.
  const sql = read(file).replace(/--.*$/gm, "");
  const re = new RegExp(`constraint\\s+${constraintName}\\s+check\\s*\\(`, "gi");
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(sql); m; m = re.exec(sql)) last = m;
  assert.ok(last, `${file}: constraint ${constraintName} 정의를 찾지 못함`);
  const openIdx = last.index + last[0].length - 1;
  return quotedLiterals(balancedParens(sql, openIdx)).filter((v) => v !== "text");
}

type InventoryRow = { schema: string; table: string; conname: string; contype: string; definition: string };
const inventory = JSON.parse(read(INVENTORY)) as InventoryRow[];

/** 인벤토리에서 `<column> = ANY (ARRAY[...])` 형태의 CHECK 값 집합(해당 테이블·컬럼) */
function checkValuesFromInventory(table: string, column: string): string[] | null {
  const rows = inventory.filter(
    (r) => r.schema === "public" && r.table === table && r.contype === "c" && new RegExp(`\\(${column} = ANY \\(ARRAY\\[`).test(r.definition)
  );
  if (rows.length === 0) return null;
  assert.equal(rows.length, 1, `${table}.${column}: CHECK 가 여러 개`);
  return quotedLiterals(rows[0].definition);
}

// ── ① 사전 == 픽스처 ───────────────────────────────────────────────────────────

test("사전 키 집합 == 픽스처 키 집합(지시서 §3 '반드시 포함할 것' 11개 컬럼 + PR-2 학교 등급·계열 2개 + PR-5 학적 변경·맞춤의뢰 주문 2개 + PR-8 질문 스레드 상태·숙달 2개 + PR-9 충전 주문·지급 실행 2개 + PR-10 공지 대상 1개)", () => {
  assert.deepEqual(sorted(ADMIN_STATUS_DICTIONARY_KEYS), sorted(Object.keys(FIXTURE)));
});

for (const key of Object.keys(FIXTURE)) {
  test(`사전 ${key} 값 집합 == DB CHECK 픽스처(누락·초과 없음)`, () => {
    const [table, column] = key.split(".");
    assert.deepEqual(sorted(adminStatusAllowedValues(table, column)), sorted(FIXTURE[key].values));
  });
}

// ── ② 픽스처 == 인벤토리 / 마이그레이션 ──────────────────────────────────────

for (const [key, fx] of Object.entries(FIXTURE)) {
  const [table, column] = key.split(".");
  if (fx.inventory) {
    test(`픽스처 ${key} == 원격 DB 인벤토리(2026-08-04) CHECK 값`, () => {
      const fromDb = checkValuesFromInventory(table, column);
      assert.ok(fromDb, `${key}: 인벤토리에 CHECK 없음`);
      assert.deepEqual(sorted(fromDb), sorted(fx.values));
    });
  }
  if (fx.constraint) {
    test(`픽스처 ${key} == 마이그레이션 ${fx.constraint.file.split("/").pop()} 의 ${fx.constraint.name}`, () => {
      assert.deepEqual(sorted(checkValuesFromMigration(fx.constraint!.file, fx.constraint!.name)), sorted(fx.values));
    });
  }
}

test("mentor_profiles.verification_status: DB 에 CHECK 가 없다 → 사전이 유일한 허용 목록(5값)", () => {
  assert.equal(checkValuesFromInventory("mentor_profiles", "verification_status"), null);
  assert.ok(read(BASELINE).includes("verification_status text not null default 'pending',"), "baseline 인라인 CHECK 없음");
  assert.deepEqual(sorted(adminStatusAllowedValues("mentor_profiles", "verification_status")), sorted([
    "pending",
    "approved",
    "rejected",
    "under_review",
    "unsubmitted",
  ]));
});

test("mentor_profiles.verification_status: 재제출 요청 값은 코드가 실제로 쓰는 under_review 다(requestMentorDocumentsAction) — resubmit_required 는 이 컬럼에 쓰는 코드가 없어 미등재", () => {
  const actions = read("lib/admin/mentorApprovalActions.ts");
  assert.ok(actions.includes('{ [STATUS_COLUMN]: "under_review" }'), "재제출 액션이 쓰는 값");
  assert.equal(resolveAdminStatus("mentor_profiles", "verification_status", "under_review").label, "재제출 요청");
  assert.equal(resolveAdminStatus("mentor_profiles", "verification_status", "resubmit_required").known, false);
});

test("app_notices.target: DB 에 CHECK 가 없다 → 사전이 유일한 허용 목록(전체·학생·멘토) · 공지 폼 옵션과 1:1(PR-10)", () => {
  assert.equal(checkValuesFromInventory("app_notices", "target"), null);
  assert.ok(read(BASELINE).includes("  target text null,"), "baseline 인라인 CHECK 없음");
  assert.deepEqual(["all", "student", "mentor"].map((v) => resolveAdminStatus("app_notices", "target", v).label), ["전체", "학생", "멘토"]);
  const notice = read("lib/admin/noticeConsole.ts");
  assert.ok(notice.includes('export const NOTICE_TARGET_VALUES = ["all", "student", "mentor"] as const;'), "폼 옵션 = 사전 값");
  assert.ok(notice.includes('resolveAdminStatus("app_notices", "target", value).label'), "옵션 라벨은 사전에서 온다");
});

test("mentor_academic_record_change_requests.status: baseline 인라인 CHECK 4값 == 사전 · 라벨은 대기·승인·반려·재제출 요청(PR-5 후속)", () => {
  assert.ok(read(BASELINE).includes("status in ('pending', 'approved', 'rejected', 'resubmit_required')"), "baseline 089 인라인 CHECK");
  assert.deepEqual(
    ["pending", "approved", "rejected", "resubmit_required"].map((v) => resolveAdminStatus("mentor_academic_record_change_requests", "status", v).label),
    ["대기", "승인", "반려", "재제출 요청"]
  );
  for (const v of ["pending", "approved", "rejected", "resubmit_required"]) assert.equal(resolveAdminStatus("mentor_academic_record_change_requests", "status", v).known, true, v);
});

test("paysync_invoices.status: 20260830100100 인라인 CHECK 4값 == 사전 · 라벨은 충전 관리 탭 표기(대기·완료·만료·취소)", () => {
  const sql = read("supabase/migrations/20260830100100_paysync_invoices.sql");
  assert.ok(sql.includes("check (status in ('pending', 'paid', 'expired', 'canceled'))"), "인라인 CHECK 원문");
  assert.deepEqual(
    ["pending", "paid", "expired", "canceled"].map((v) => resolveAdminStatus("paysync_invoices", "status", v).label),
    ["대기", "완료", "만료", "취소"]
  );
  assert.equal(resolveAdminStatus("paysync_invoices", "status", "paid").risk, "high", "완료 = 캐시 적립 완료(자금 확정)");
});

test("payout_runs.status: baseline 인라인 CHECK 2값 == 사전(실행 중·완료)", () => {
  assert.ok(read(BASELINE).includes("status text not null default 'executing' check (status in ('executing', 'completed'))"), "baseline 106 인라인 CHECK");
  assert.deepEqual(["executing", "completed"].map((v) => resolveAdminStatus("payout_runs", "status", v).label), ["실행 중", "완료"]);
});

test("custom_request_orders.status: DB 에 CHECK 가 없다 → 사전은 코드가 쓰는 값(관리자 집계 8종)만 — 집계 목록과 1:1 · 레거시 동의어는 미등재(neutral)", () => {
  assert.equal(checkValuesFromInventory("custom_request_orders", "status"), null);
  const q = read("lib/admin/adminQueries.ts");
  const fnStart = q.indexOf("export async function countAdminCustomRequestOrdersByStatus");
  assert.ok(fnStart >= 0);
  const listStart = q.indexOf("const statuses = [", fnStart);
  const listed = [...q.slice(listStart, q.indexOf("];", listStart)).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(sorted(listed), sorted(adminStatusAllowedValues("custom_request_orders", "status")), "사전 == 관리자 집계가 세는 값");
  for (const legacy of ["canceled", "accepted", "done", "finished", "closed", "in_progress", "submitted", "unpaid", "paid"]) {
    const r = resolveAdminStatus("custom_request_orders", "status", legacy);
    assert.equal(r.known, false, legacy);
    assert.equal(r.tone, "neutral", legacy);
  }
});

test("content_reports.status 라벨(PR-5 후속 오너 확정): 대기 · 검토 중 · 해결 · 반려 · 기각 · 숨김 처리 · 삭제 처리 — 콘텐츠 검수 탭이 이 라벨을 그대로 쓴다", () => {
  assert.deepEqual(
    ["pending", "reviewing", "resolved", "rejected", "dismissed", "hidden", "removed"].map((v) => resolveAdminStatus("content_reports", "status", v).label),
    ["대기", "검토 중", "해결", "반려", "기각", "숨김 처리", "삭제 처리"]
  );
  const console_ = read("lib/admin/contentReportConsole.ts");
  assert.ok(console_.includes('resolveAdminStatus("content_reports", "status", value).label'), "탭 라벨은 사전에서 온다");
});

test("disputes.status 라벨(PR-6 후속 · 오너 확정): 열림 · 검토 중 · 상위 이관 · 보류 · 해결 · 기각 · 제재 7일 · 제재 30일 · 영구 제재 — 분쟁 탭은 사전에서 파생", () => {
  assert.deepEqual(
    ["open", "under_review", "escalated", "on_hold", "resolved", "dismissed", "sanction_7d", "sanction_30d", "sanction_permanent"].map((v) => resolveAdminStatus("disputes", "status", v).label),
    ["열림", "검토 중", "상위 이관", "보류", "해결", "기각", "제재 7일", "제재 30일", "영구 제재"]
  );
  const disputeConsole = readFileSync(join(ROOT, "lib/admin/disputeConsole.ts"), "utf8");
  assert.ok(disputeConsole.includes('resolveAdminStatus("disputes", "status", value).label'), "탭 라벨은 사전에서 온다");
});

// ── ③ 정규화 규칙 ─────────────────────────────────────────────────────────────

test("payments.status: 성공 동의어 5종(succeeded·paid·success·complete·captured)은 모두 '결제 완료'/success 하나로", () => {
  assert.deepEqual([...PAYMENT_SUCCEEDED_SYNONYMS], ["succeeded", "paid", "success", "complete", "captured"]);
  for (const v of PAYMENT_SUCCEEDED_SYNONYMS) {
    const r = resolveAdminStatus("payments", "status", v);
    assert.equal(r.known, true, v);
    assert.equal(r.label, "결제 완료", v);
    assert.equal(r.tone, "success", v);
  }
  // 실패·취소·환불은 성공과 섞이지 않는다
  assert.notEqual(resolveAdminStatus("payments", "status", "failed").label, "결제 완료");
  assert.notEqual(resolveAdminStatus("payments", "status", "refunded").label, "결제 완료");
});

test("모든 항목: 라벨 비어 있지 않음 · 톤은 5종 안 · 금지 문구 없음 · 라벨은 한글 포함", () => {
  const banned = ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "정산 대기", "작업전"];
  for (const key of ADMIN_STATUS_DICTIONARY_KEYS) {
    for (const [value, entry] of Object.entries(ADMIN_STATUS_DICTIONARY[key])) {
      assert.ok(entry.label.trim().length > 0, `${key}.${value} 라벨 비어 있음`);
      assert.ok((ADMIN_STATUS_TONES as readonly string[]).includes(entry.tone), `${key}.${value} 톤 ${entry.tone}`);
      assert.ok(/[가-힣]/.test(entry.label), `${key}.${value} 라벨에 한글 없음: ${entry.label}`);
      for (const word of banned) assert.ok(!entry.label.includes(word), `${key}.${value} 금지 문구 ${word}`);
      if (entry.risk !== undefined) assert.ok(["high", "medium"].includes(entry.risk), `${key}.${value} risk`);
    }
  }
});

test("같은 컬럼 안에서 서로 다른 값이 같은 라벨을 갖는 경우는 payments 성공 동의어만이다", () => {
  for (const key of ADMIN_STATUS_DICTIONARY_KEYS) {
    const byLabel = new Map<string, string[]>();
    for (const [value, entry] of Object.entries(ADMIN_STATUS_DICTIONARY[key])) {
      byLabel.set(entry.label, [...(byLabel.get(entry.label) ?? []), value]);
    }
    for (const [label, values] of byLabel) {
      if (values.length < 2) continue;
      assert.equal(key, "payments.status", `${key}: '${label}' 가 ${values.join(",")} 에 중복`);
      assert.deepEqual(sorted(values), sorted(PAYMENT_SUCCEEDED_SYNONYMS));
    }
  }
});

// ── ④ 미등재 값에서 throw 하지 않음 ────────────────────────────────────────────

test("resolveAdminStatus: 미등재 값은 neutral + 원시 값, known=false — throw 하지 않는다", () => {
  const r = resolveAdminStatus("refunds", "status", "weird_value");
  assert.deepEqual(r, { label: "weird_value", tone: "neutral", known: false, raw: "weird_value" });
  assert.equal(resolveAdminStatus("no_such_table", "status", "pending").known, false);
  assert.equal(resolveAdminStatus("refunds", "no_such_column", "pending").tone, "neutral");
});

test("resolveAdminStatus: null/undefined/빈 문자열/숫자/객체 입력도 안전('—' 또는 문자열화)", () => {
  for (const v of [null, undefined, "", "   "]) {
    const r = resolveAdminStatus("users", "status", v);
    assert.equal(r.label, "—", String(v));
    assert.equal(r.tone, "neutral");
    assert.equal(r.known, false);
  }
  assert.doesNotThrow(() => resolveAdminStatus("users", "status", 42));
  assert.doesNotThrow(() => resolveAdminStatus("users", "status", { a: 1 }));
  assert.equal(resolveAdminStatus("users", "status", 42).label, "42");
});

test("resolveAdminStatus: 대소문자·양끝 공백만 다른 값은 등재 값으로 인식한다(예: 'PENDING', ' approved ')", () => {
  assert.equal(resolveAdminStatus("mentor_profiles", "verification_status", "PENDING").label, "승인 대기");
  assert.equal(resolveAdminStatus("mentor_profiles", "verification_status", " approved ").known, true);
  assert.equal(resolveAdminStatus("refunds", "status", "Succeeded").tone, "success");
});

test("mentor_profiles.verification_status: 레거시 동의어(submitted·verified·declined 등)와 타 테이블 값(resubmit_required)은 등재되지 않았다 → neutral 폴백", () => {
  // 허용 목록 5값만 사전에 둔다. 코드(mentorApprovalConstants.ts)가 아직 관용하는 동의어는 PR 설명의 충돌 목록에 적는다.
  for (const legacy of ["submitted", "resubmit_required", "awaiting", "review", "new", "verified", "active", "declined", "suspended", "inactive"]) {
    const r = resolveAdminStatus("mentor_profiles", "verification_status", legacy);
    assert.equal(r.known, false, legacy);
    assert.equal(r.tone, "neutral", legacy);
    assert.equal(r.label, legacy, legacy);
  }
});

// ── ⑤ AdminStatusPill tripwire ───────────────────────────────────────────────

test("AdminStatusPill: 사전(resolveAdminStatus) 경유 · DS StatusBadge 로 렌더 · throw 없음 · table/column/value props", () => {
  const src = read("components/admin/AdminStatusPill.tsx");
  assert.ok(src.includes('from "@/lib/admin/adminStatusDictionary"'));
  assert.ok(src.includes("resolveAdminStatus(table, column, value)"));
  assert.ok(src.includes('from "@/components/design-system/StatusBadge"'));
  assert.ok(src.includes("<StatusBadge label={resolved.label} tone={resolved.tone}"));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/\bthrow\b/.test(code), "운영 화면이 깨지면 안 된다 — throw 금지");
  assert.ok(!src.startsWith('"use client"'), "상태 없는 표시 컴포넌트 — Server Component 로 두어 어디서든 쓴다");
  for (const prop of ["table: string", "column: string", "value: unknown"]) assert.ok(src.includes(prop), prop);
});

test("사전 모듈은 React·@/ import 없이 node 에서 단독 로드된다(계약 테스트 전제)", () => {
  const src = read("lib/admin/adminStatusDictionary.ts");
  assert.ok(!/^import /m.test(src), "사전은 import 없는 순수 모듈이어야 한다");
});
