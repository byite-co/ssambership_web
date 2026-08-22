import Link from "next/link";

export const metadata = {
  title: "만 14세 미만 보호자 동의",
  description: "쌤버십 만 14세 미만 회원의 법정대리인 동의 안내입니다.",
};

export default function LegalMinorConsentPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <header>
        <h1 className="text-2xl font-black text-slate-900">만 14세 미만 보호자 동의</h1>
        <p className="mt-2 text-sm text-slate-600">
          만 14세 미만 아동은 「개인정보 보호법」에 따라 법정대리인의 동의를 확인한 후 서비스를 이용할 수 있습니다.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-base font-extrabold text-slate-900">동의 확인 절차</h2>
        <ul className="list-inside list-disc space-y-2 text-sm text-slate-700">
          <li>회원가입 후 가입자 본인의 휴대폰 본인인증을 먼저 진행합니다.</li>
          <li>
            가입자가 만 14세 미만으로 확인되면, 이어서 보호자(법정대리인) 본인의 휴대폰 본인인증으로 법정대리인의
            동의를 확인합니다. 인증은 본인확인기관인 NICE평가정보(주)의 휴대폰 본인확인 서비스를 통해 진행됩니다.
          </li>
          <li>
            보호자 인증을 진행하면 가입자의 법정대리인 본인임을 확인하며, 만 14세 미만 아동의 개인정보 수집·이용에
            동의한 것으로 기록됩니다.
          </li>
          <li>보호자는 만 19세 이상 성인이어야 하며, 보호자 본인 명의 휴대폰으로만 진행할 수 있습니다(가입자 본인 명의 불가).</li>
          <li>법정대리인의 동의가 확인되기 전까지 서비스 이용이 제한됩니다.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-extrabold text-slate-900">법정대리인 개인정보의 처리</h2>
        <ul className="list-inside list-disc space-y-2 text-sm text-slate-700">
          <li>
            보호자 본인인증 과정에서 법정대리인의 성명, 생년월일, 성별, 내·외국인 정보, 휴대폰번호, 이동통신사,
            연계정보(CI), 중복가입확인정보(DI)가 수집·이용됩니다. 자세한 내용은{" "}
            <Link href="/legal/privacy" className="font-bold text-blue-700 underline">
              개인정보처리방침
            </Link>
            을 확인하십시오.
          </li>
          <li>
            법정대리인은 아동의 개인정보에 대한 열람·정정·삭제·처리정지를 요구할 수 있습니다(개인정보처리방침 제6조).
          </li>
        </ul>
      </section>

      <p className="text-sm">
        <Link href="/signup" className="font-bold text-blue-700 underline">
          회원가입
        </Link>
      </p>
    </div>
  );
}
