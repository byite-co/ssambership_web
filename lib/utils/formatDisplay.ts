/**
 * 앱 전역 표시 포맷 — 날짜·캐시 단위 통일
 */

/**
 * 예: 2024.06.07 — 시각이 포함된 타임스탬프는 KST(UTC+9) 달력 날짜로 변환해 표기한다.
 *
 * N21: 구 구현은 ISO 문자열의 앞 `YYYY-MM-DD` 를 정규식으로 잘라 그대로 썼다 — 시간대 변환
 * 없이 UTC 날짜가 노출되어, `…T15:00Z`(KST 자정) 이후 값은 하루 이른 날짜로 보였다
 * (예: account_deletion_jobs.cancelable_until 30일 마감일). 실행 환경(서버 UTC·브라우저
 * KST)과 무관하게 epoch 에 고정 +9h 산술을 적용해 KST 달력 날짜를 얻는다.
 * 전제: 시각이 있는 입력은 오프셋을 포함한다(Postgres timestamptz → PostgREST 는 항상
 * `+00:00` 부착). 순수 날짜 문자열(`YYYY-MM-DD`)은 달력 날짜 그 자체이므로 변환 없이 표기.
 */
export function formatKoreanDate(iso: unknown): string {
  if (iso == null || iso === "") return "—";
  const raw = typeof iso === "string" ? iso : String(iso);
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[1]}.${dateOnly[2]}.${dateOnly[3]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

/** 1캐시 = 1원 — UI 표기용 */
export function formatCashKrw(amount: number, options?: { unit?: "캐시" | "원" }): string {
  const unit = options?.unit ?? "캐시";
  const n = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `${n.toLocaleString("ko-KR")} ${unit}`;
}

/** cash_ledger / balance_cents 등 minor(×100) → 캐시 정수 */
export function minorUnitsToDisplayCash(minor: number): number {
  return Math.floor(Math.abs(minor) / 100);
}
