// 계약 테스트: 관리자 공지·이벤트(PR-10 §1) — 목록(유형 탭·만료 표시) · 작성·수정 폼(노출 방식 팝업 · 미리보기) · 활성 토글 확인 등급 · 프로모션 접힘.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/noticeConsole.contract.test.ts
//
// 고정하는 것(지시서 §4):
//   ① `display_mode` 라디오 렌더 · 팝업 선택 시 미리보기 컴포넌트(`NoticePopupPreview`) 렌더 · 미리보기 부품은 관리자 모듈을 import 하지 않는다(PR-10b 재사용)
//   ② 팝업 활성화만 `stateChange`(summary 고정) · 목록 활성화·비활성화는 즉시
//   ③ 기간이 지난 활성 공지는 `만료됨` · 시작 전 `예정`
//   ④ 유형 탭·대상·노출 방식 값은 상태 사전에서 · `target` 3값 · 이미지 첨부 없음 · 서비스 화면에 팝업 마운트 0(PR-10b)
//   ⑤ 프로모션 섹션은 접힌 상태 + `사용 이력 없음` · 새 프로모션 폼 없음 · 빈 상태 문구

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOTICE_DEFAULT_TYPE_TAB,
  NOTICE_DISPLAY_MODE_BADGE,
  NOTICE_DISPLAY_MODE_OPTIONS,
  NOTICE_EMPTY_STATE,
  NOTICE_EXPOSURE_LABELS,
  NOTICE_FORM_ERRORS,
  NOTICE_POPUP_ACTIVATE_SUMMARY,
  NOTICE_POPUP_PENDING_NOTICE,
  NOTICE_TARGET_OPTIONS,
  NOTICE_TARGET_VALUES,
  NOTICE_TYPE_TABS,
  NOTICE_TYPE_VALUES,
  PROMOTION_NO_USAGE_LABEL,
  buildNoticeListUrl,
  buildNoticeTypeTabUrl,
  formatNoticePeriod,
  noticeDictionaryValues,
  noticeEditUrl,
  noticeEmptyState,
  noticeExposureState,
  noticeFlashOkMessage,
  noticeFormDefaults,
  noticeToggleConfirmLevel,
  parseNoticeRow,
  resolveNoticeDisplayMode,
  resolveNoticeTarget,
  resolveNoticeTypeTab,
  toKstDatetimeLocal,
  validateNoticeFormInput,
} from "../noticeConsole.ts";
import { parseAdminListParams } from "../adminListParams.ts";
import { adminStatusAllowedValues, resolveAdminStatus } from "../adminStatusDictionary.ts";
import { ADMIN_CONSOLE_NAV } from "../../../components/admin/adminConsoleNavConfig.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE = "app/(admin)/admin/(console)/notices/page.tsx";
const FORM = "components/admin/NoticeEditorForm.tsx";
const TABLE = "components/admin/NoticeListTable.tsx";
const TOOLBAR = "components/admin/NoticeListToolbar.tsx";
const PROMO = "components/admin/PromotionSection.tsx";
const PREVIEW = "components/notices/NoticePopupPreview.tsx";
const ACTIONS = "lib/admin/adminNoticesActions.ts";
const MUTATIONS = "lib/admin/adminNoticesMutations.ts";
const QUERIES = "lib/admin/adminNoticesQueries.ts";

const NOW = "2026-09-03T05:00:00Z";

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const ROW = {
  id: "d408e62b-6a21-4c0e-a18d-9df203f8496d",
  title: "가입하신 멘토 분들께",
  body: "본문",
  type: "notice",
  target: null,
  display_mode: "page",
  is_active: true,
  starts_at: "2026-08-30 12:00:00+00",
  ends_at: "2026-08-31 14:59:00+00",
  created_at: "2026-08-30 11:28:54.380095+00",
  updated_at: "2026-08-30 11:28:54.380095+00",
};

// ── ④ 값은 사전에서 ─────────────────────────────────────────────────────────

test("유형 탭 = 사전 app_notices.type 4값 + 전체 · 라벨은 사전 그대로(공지·이벤트·점검·업데이트) · 기본 탭 전체", () => {
  assert.deepEqual([...NOTICE_TYPE_VALUES], adminStatusAllowedValues("app_notices", "type"));
  assert.deepEqual(NOTICE_TYPE_TABS.map((t) => t.value), ["all", "notice", "event", "maintenance", "update"]);
  assert.deepEqual(NOTICE_TYPE_TABS.map((t) => t.label), ["전체", "공지", "이벤트", "점검", "업데이트"]);
  assert.equal(NOTICE_DEFAULT_TYPE_TAB, "all");
  assert.equal(resolveNoticeTypeTab("event"), "event");
  assert.equal(resolveNoticeTypeTab("bogus"), "all");
  assert.equal(resolveNoticeTypeTab(undefined), "all");
});

test("대상 = 사전 app_notices.target 3값(전체·학생·멘토) · NULL·모르는 값은 전체 · 노출 방식은 사전 2값", () => {
  const dict = noticeDictionaryValues();
  assert.deepEqual([...NOTICE_TARGET_VALUES], dict.target);
  assert.deepEqual(NOTICE_TARGET_OPTIONS.map((o) => o.label), ["전체", "학생", "멘토"]);
  assert.equal(resolveNoticeTarget(null), "all");
  assert.equal(resolveNoticeTarget(""), "all");
  assert.equal(resolveNoticeTarget("홈"), "all", "구 자유 문자열은 전체로 읽는다");
  assert.equal(resolveNoticeTarget("MENTOR"), "mentor");
  assert.deepEqual(dict.displayMode, ["page", "popup"]);
  assert.deepEqual(NOTICE_DISPLAY_MODE_OPTIONS.map((o) => o.value), ["page", "popup"]);
  assert.equal(resolveNoticeDisplayMode("popup"), "popup");
  assert.equal(resolveNoticeDisplayMode(undefined), "page");
  assert.equal(resolveNoticeDisplayMode("banner"), "page");
  assert.deepEqual(NOTICE_DISPLAY_MODE_BADGE, { page: "목록", popup: "팝업" });
  assert.equal(resolveAdminStatus("app_notices", "display_mode", "popup").label, "팝업 노출");
});

// ── ② 활성 토글 확인 등급 ────────────────────────────────────────────────────

test("팝업 공지의 활성화만 stateChange(summary '이 공지가 팝업으로 전체 사용자에게 표시됩니다.') · 목록 공지·비활성화는 즉시", () => {
  assert.equal(noticeToggleConfirmLevel("popup", true), "stateChange");
  assert.equal(noticeToggleConfirmLevel("popup", false), "immediate");
  assert.equal(noticeToggleConfirmLevel("page", true), "immediate");
  assert.equal(noticeToggleConfirmLevel("page", false), "immediate");
  assert.equal(NOTICE_POPUP_ACTIVATE_SUMMARY, "이 공지가 팝업으로 전체 사용자에게 표시됩니다.");
});

// ── ③ 노출 상태 ──────────────────────────────────────────────────────────────

test("노출 상태: 기간이 지난 활성 공지는 만료됨 · 시작 전 예정 · 기간 내 표시 중 · 비활성은 숨김 · 종료 시각 정각은 아직 표시 중(RLS ends_at >= now 와 같은 경계)", () => {
  const base = { isActive: true, startsAt: "2026-08-30T12:00:00+00:00", endsAt: "2026-08-31T14:59:00+00:00" };
  assert.equal(noticeExposureState(base, NOW), "expired");
  assert.equal(noticeExposureState({ ...base, endsAt: null }, NOW), "active");
  assert.equal(noticeExposureState({ ...base, startsAt: "2026-09-10T00:00:00Z", endsAt: null }, NOW), "scheduled");
  assert.equal(noticeExposureState({ ...base, isActive: false }, NOW), "inactive");
  assert.equal(noticeExposureState({ isActive: true, startsAt: null, endsAt: NOW }, NOW), "active");
  assert.equal(noticeExposureState({ isActive: true, startsAt: null, endsAt: null }, NOW), "active");
  assert.deepEqual(NOTICE_EXPOSURE_LABELS, { active: "표시 중", expired: "만료됨", scheduled: "예정", inactive: "숨김" });
});

test("행 파싱: 실제 행(5건 중 1건) → 대상 NULL 은 전체 · display_mode page · 기간 표기 KST", () => {
  const it = parseNoticeRow(ROW)!;
  assert.equal(it.id, ROW.id);
  assert.equal(it.type, "notice");
  assert.equal(it.target, "all");
  assert.equal(it.displayMode, "page");
  assert.equal(it.isActive, true);
  assert.equal(noticeExposureState(it, NOW), "expired");
  assert.equal(formatNoticePeriod(null, null), "기간 미설정");
  assert.ok(formatNoticePeriod(it.startsAt, it.endsAt).includes(" ~ "));
  assert.ok(formatNoticePeriod(null, it.endsAt).startsWith("~ "));
  assert.ok(formatNoticePeriod(it.startsAt, null).endsWith(" ~"));
  assert.equal(parseNoticeRow({ title: "id 없음" }), null);
});

// ── 폼 ────────────────────────────────────────────────────────────────────────

test("datetime-local 변환: timestamptz → KST 벽시계(YYYY-MM-DDTHH:mm) · 수정 폼 기본값은 행 값", () => {
  assert.equal(toKstDatetimeLocal("2026-08-30T12:00:00+00:00"), "2026-08-30T21:00");
  assert.equal(toKstDatetimeLocal("2026-08-31T14:59:00Z"), "2026-08-31T23:59");
  assert.equal(toKstDatetimeLocal(null), "");
  assert.equal(toKstDatetimeLocal("not a date"), "");
  const d = noticeFormDefaults(parseNoticeRow({ ...ROW, display_mode: "popup", target: "student" }));
  assert.equal(d.displayMode, "popup");
  assert.equal(d.target, "student");
  assert.equal(d.start, "2026-08-30T21:00");
  assert.equal(d.active, true);
  const blank = noticeFormDefaults(null);
  assert.deepEqual(blank, { title: "", body: "", type: "notice", target: "all", displayMode: "page", start: "", end: "", active: true });
});

test("서버 검증: 제목 필수 · 유형·대상·노출 방식은 사전 값만 · 종료 < 시작 거부 · 통과 시 값 정규화", () => {
  assert.deepEqual(validateNoticeFormInput({ title: " " }), { ok: false, error: NOTICE_FORM_ERRORS.titleRequired });
  assert.deepEqual(validateNoticeFormInput({ title: "t", type: "promo" }), { ok: false, error: NOTICE_FORM_ERRORS.typeInvalid });
  assert.deepEqual(validateNoticeFormInput({ title: "t", target: "홈" }), { ok: false, error: NOTICE_FORM_ERRORS.targetInvalid });
  assert.deepEqual(validateNoticeFormInput({ title: "t", display_mode: "banner" }), { ok: false, error: NOTICE_FORM_ERRORS.displayModeInvalid });
  assert.deepEqual(validateNoticeFormInput({ title: "t", start: "2026-09-03" }), { ok: false, error: NOTICE_FORM_ERRORS.datetimeInvalid });
  assert.deepEqual(validateNoticeFormInput({ title: "t", start: "2026-09-03T10:00", end: "2026-09-03T09:00" }), { ok: false, error: NOTICE_FORM_ERRORS.endBeforeStart });
  const ok = validateNoticeFormInput({ title: " 점검 ", body: " 본문 ", type: "MAINTENANCE", target: "mentor", display_mode: "popup", start: "2026-09-03T10:00", end: "", active: "on" });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.value, { title: "점검", body: "본문", type: "maintenance", target: "mentor", displayMode: "popup", start: "2026-09-03T10:00", end: "", active: true });
  }
});

// ── 링크 · 플래시 · 빈 상태 ─────────────────────────────────────────────────

test("링크: 유형 탭은 extra `type`(전체는 제거) · 검색·페이지 보존 · 수정 링크는 ?edit=<id>#notice-editor · 플래시 · 빈 상태 2종", () => {
  const params = parseAdminListParams({ q: "점검", type: "event", page: "2" }, { defaultPageSize: 25 });
  const p = { ...params, status: "", extra: { type: "event" } };
  assert.ok(buildNoticeTypeTabUrl(p, "all").includes("q=") && !buildNoticeTypeTabUrl(p, "all").includes("type="), "전체 탭은 type 제거");
  assert.ok(buildNoticeTypeTabUrl(p, "notice").includes("type=notice") && !buildNoticeTypeTabUrl(p, "notice").includes("page="), "탭 전환 시 page 리셋");
  assert.ok(buildNoticeListUrl(p, { page: 3 }).includes("type=event") && buildNoticeListUrl(p, { page: 3 }).includes("page=3"));
  assert.equal(noticeEditUrl(ROW.id), `/admin/notices?edit=${ROW.id}#notice-editor`);
  assert.equal(noticeFlashOkMessage("created"), "공지를 등록했습니다.");
  assert.equal(noticeFlashOkMessage("updated"), "공지를 수정했습니다.");
  assert.equal(noticeFlashOkMessage("1"), "변경을 저장했습니다.");
  assert.equal(noticeFlashOkMessage("x"), null);
  assert.equal(noticeEmptyState("all", "", 0).title, "등록된 공지가 없습니다");
  assert.equal(noticeEmptyState("event", "", 5).title, NOTICE_EMPTY_STATE.filtered.title);
  assert.equal(noticeEmptyState("all", "점검", 5).title, NOTICE_EMPTY_STATE.filtered.title);
});

// ── ① 폼·미리보기 tripwire ───────────────────────────────────────────────────

test("폼: 클라이언트 · display_mode 라디오(page·popup) · 팝업 선택 시 미리보기 버튼 + NoticePopupPreview · 상단 '서비스 반영 후' 안내 · 이미지 첨부 없음 · 작성/수정 액션 분기", () => {
  const src = read(FORM);
  const code = stripComments(src);
  assert.ok(src.startsWith('"use client"'));
  assert.ok(code.includes('name="display_mode"') && code.includes("NOTICE_DISPLAY_MODE_OPTIONS.map"), "노출 방식 라디오");
  assert.ok(code.includes('displayMode === "popup" ? (') && code.includes("data-notice-preview-button"), "팝업일 때만 미리보기 버튼");
  assert.ok(code.includes('import { NoticePopupPreview } from "@/components/notices/NoticePopupPreview";'), "미리보기는 공용 부품");
  assert.ok(code.includes("<NoticePopupPreview notice={{ title, body, typeLabel: noticeTypeLabel(type) }}") && code.includes("preview />"), "제목·본문을 모달로");
  assert.ok(code.includes("NOTICE_POPUP_PENDING_NOTICE"), "PR-10b 전 안내");
  assert.equal(NOTICE_POPUP_PENDING_NOTICE, "팝업 노출은 서비스 반영 후 적용됩니다.");
  assert.ok(!/type="file"|image_url|accept=/.test(code), "이미지 첨부 없음(DB 보류)");
  assert.ok(code.includes("isEdit ? updateAdminNoticeAction : submitAdminNoticeDraft"), "수정·작성 액션 분기");
  assert.ok(code.includes('name="target"') && code.includes("NOTICE_TARGET_OPTIONS.map"), "대상은 사전 옵션");
  for (const banned of ["선생님", "강사님", "수강생", "과외", "alert("]) assert.ok(!code.includes(banned), banned);
});

test("NoticePopupPreview: 클라이언트 · 관리자 모듈 import 0(PR-10b 서비스 마운트용) · role=dialog · 오늘 하루 보지 않기 · 미리보기 배지 · 서비스 화면 마운트는 아직 없다", () => {
  const src = read(PREVIEW);
  const code = stripComments(src);
  assert.ok(src.startsWith('"use client"'));
  assert.ok(!/@\/lib\/admin|@\/components\/admin|adminNotices|noticeConsole/.test(code), "관리자 모듈 의존 없음");
  assert.ok(code.includes("export function NoticePopupPreview("));
  assert.ok(code.includes('role="dialog"') && code.includes('aria-modal="true"'), "a11y");
  assert.ok(code.includes("오늘 하루 보지 않기") && code.includes("onDismissToday"), "PR-10b 가 연결할 dismiss 훅");
  assert.ok(code.includes("data-notice-popup-preview-badge"), "미리보기 배지");
  assert.ok(code.includes('e.key === "Escape"'), "Esc 닫기");
  // 서비스 화면(공개·학생·멘토·루트 레이아웃)에는 아직 마운트하지 않는다 — PR-10b
  const files = [...walk(join(ROOT, "app"), []), ...walk(join(ROOT, "components"), [])];
  const mounts = files
    .map((f) => f.slice(ROOT.length).replace(/\\/g, "/").replace(/^\/+/, ""))
    .filter((rel) => !rel.startsWith("app/(admin)/") && !rel.startsWith("components/admin/") && rel !== PREVIEW)
    .filter((rel) => readFileSync(join(ROOT, rel), "utf8").includes("NoticePopupPreview"));
  assert.deepEqual(mounts, [], "서비스 화면 팝업 마운트는 PR-10b");
});

test("목록 표: Server Component · 팝업 활성화만 ConfirmSubmitButton stateChange(summary 고정) · 그 외 immediate · 팝업 배지 눈에 띄게 · 만료 라벨 · 수정 링크 · 페이지네이션 공용", () => {
  const src = read(TABLE);
  const code = stripComments(src);
  assert.ok(!src.startsWith('"use client"'));
  assert.ok(code.includes("noticeToggleConfirmLevel(it.displayMode, nextActive)"), "확인 등급은 순수 규칙");
  assert.ok(code.includes('level="stateChange"') && code.includes("summary={NOTICE_POPUP_ACTIVATE_SUMMARY}"), "팝업 활성화 확인");
  assert.ok(code.includes('level="immediate"'), "목록 공지·비활성화는 즉시");
  assert.ok(code.includes("data-notice-popup-badge") && code.includes("border-[#F59E0B]"), "팝업 배지 강조");
  assert.ok(code.includes("NOTICE_EXPOSURE_LABELS[exposure]"), "만료됨·예정 표시");
  assert.ok(code.includes("noticeEditUrl(it.id)"), "수정 링크");
  assert.ok(code.includes("<AdminDataTable.Pagination") && !code.includes('aria-label="상태 탭"'), "페이지네이션은 공용 조각 · 탭 마크업 없음");
  assert.ok(code.includes('<AdminStatusPill table="app_notices" column="type"') && code.includes('<AdminStatusPill table="app_notices" column="target"'), "유형·대상은 사전 배지");
  const toolbar = stripComments(read(TOOLBAR));
  assert.ok(toolbar.includes('aria-label="유형 탭"') && toolbar.includes("NOTICE_TYPE_TABS.map") && !toolbar.includes("<AdminDataTable."), "유형 탭은 화면이 직접(status 키 아님 · prop 추가 0)");
  assert.ok(toolbar.includes("data-notice-counts") && toolbar.includes("활성 <span"), "활성 N / 전체 M");
  assert.ok(toolbar.includes('{tab !== NOTICE_DEFAULT_TYPE_TAB ? <input type="hidden" name={NOTICE_TYPE_PARAM} value={tab} /> : null}'), "검색해도 탭 유지");
});

// ── ⑤ 프로모션 · 페이지 · 액션 tripwire ─────────────────────────────────────

test("프로모션 섹션: <details> 접힘(open 없음) · 헤더 '사용 이력 없음' · 새 프로모션 폼 없음 · 토글은 즉시", () => {
  const code = stripComments(read(PROMO));
  assert.ok(/<details\b(?![^>]*\bopen\b)/.test(code), "접힌 상태");
  assert.ok(code.includes("PROMOTION_NO_USAGE_LABEL"));
  assert.equal(PROMOTION_NO_USAGE_LABEL, "사용 이력 없음");
  assert.ok(!code.includes("submitAdminNoticeDraft"), "프로모션 작성 폼 없음(삭제는 오너 결정 후)");
  assert.ok(code.includes('level="immediate"') && !code.includes('level="stateChange"'));
});

test("페이지: AdminPageLayout(PageScaffold 없음) · 툴바·표·폼·프로모션 조립 · edit 는 extra 에 싣지 않는다 · 빈 상태 EmptyState", () => {
  const code = stripComments(read(PAGE));
  assert.ok(code.includes("<AdminPageLayout") && !code.includes("PageScaffold"));
  assert.ok(code.includes("<NoticeListToolbar") && code.includes("<NoticeListTable") && code.includes("<NoticeEditorForm") && code.includes("<PromotionSection"));
  assert.ok(code.includes("if (tab !== \"all\") extra[NOTICE_TYPE_PARAM] = tab;") && code.includes("extra }"), "extra 는 type 만");
  assert.ok(code.includes("<EmptyState title={empty.title}"));
  assert.ok(code.includes('title="공지·이벤트"'));
  for (const gone of ["components/admin/AdminNoticesList.tsx", "components/admin/AdminNoticesFormSkeleton.tsx", "lib/admin/adminNoticesDataModel.ts"]) {
    assert.ok(!existsSync(join(ROOT, gone)), `${gone} 삭제(구 부품)`);
  }
  assert.equal(ADMIN_CONSOLE_NAV.find((n) => n.href === "/admin/notices")?.label, "공지·이벤트");
});

test("쓰기는 기존 액션 모듈만: 'use server' · 액션 3종 모두 requireRole(admin) 첫 줄 · 서버 검증 · 수정은 notice_updated_notice 기록 · 저장 열은 type·target·display_mode(이미지 없음) · 조회 모듈은 select 만", () => {
  const actions = read(ACTIONS);
  const code = stripComments(actions);
  assert.ok(actions.startsWith('"use server"'));
  const fns = code.match(/export async function \w+\(formData: FormData\) \{\n  const \{ user \} = await requireRole\("admin"\);/g) ?? [];
  assert.equal(fns.length, 3, "submit · update · toggle 모두 requireRole 첫 줄");
  assert.ok(code.includes("validateNoticeFormInput("), "서버 검증");
  assert.ok(code.includes('actionType: "notice_updated_notice"') && code.includes('actionType: "notice_created_notice"'), "감사 로그");
  assert.ok(code.includes("`notice_activated_${resource}`"), "토글 로그는 기존 접미사 그대로");
  const mutations = stripComments(read(MUTATIONS));
  assert.ok(mutations.includes("display_mode: input.displayMode") && mutations.includes("type: input.type") && mutations.includes("target: input.target"), "저장 열");
  assert.ok(mutations.includes("export async function updateAdminNotice("), "수정 mutation");
  assert.ok(!/image_url|thumbnail/.test(mutations), "이미지 컬럼 없음(DB 보류)");
  const queries = stripComments(read(QUERIES));
  assert.ok(queries.includes('import "server-only"'));
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(queries), "조회 모듈에 쓰기 없음");
  // DB·마이그레이션 변경 0 — 이 PR 이 추가한 SQL 파일이 없다(display_mode 는 08-30 에 이미 있다)
  assert.ok(existsSync(join(ROOT, "supabase/migrations/20260830140804_add_display_mode_to_app_notices.sql")));
});
