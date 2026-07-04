import Link from "next/link";

/** 탈퇴 완료 안내 (스펙 §3) — 비로그인 상태로 도달하는 공개 페이지 */
export default function GoodbyePage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-black text-slate-900">탈퇴가 완료되었습니다</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        개인정보는 익명화되었고 로그인이 영구 차단되었습니다.
        <br />
        거래·정산 기록은 관련 법령에 따라 익명 상태로 보존됩니다.
        <br />
        그동안 쌤버십을 이용해 주셔서 감사합니다.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex rounded-xl bg-[#1A56DB] px-5 py-2.5 text-sm font-extrabold text-white hover:bg-blue-700"
      >
        홈으로 가기
      </Link>
    </div>
  );
}
