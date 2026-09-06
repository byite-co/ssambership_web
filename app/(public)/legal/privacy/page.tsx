import type { ReactNode } from "react";
import Link from "next/link";
import { LegalDocLayout, LegalList, LegalSection } from "@/components/legal/LegalDocLayout";
import { COMPANY, PROCESSORS } from "@/lib/legal/companyInfo";
import {
  SOCIAL_LOGIN_REVISION_ACTIVE as SOCIAL_LOGIN_REVISION_ACTIVE_SHARED,
  SOCIAL_LOGIN_REVISION_EFFECTIVE_DATE_LABEL,
} from "@/lib/legal/socialLoginRevision";

export const metadata = {
  title: "개인정보처리방침",
  description: "쌤버십 개인정보처리방침입니다.",
};

// 소셜 로그인(카카오·구글·애플) 도입 고지 개정의 시행일 — 정본은 `lib/legal/socialLoginRevision.ts`(오너 확정 2026-09-13).
// 같은 상수를 `components/auth/SocialLoginButtons.tsx` 가 노출 게이트로 쓴다(시행일 전엔 버튼 미노출 · 제12조 7일 사전 공지).
// ACTIVE 가 false(시행일 미확정)면 아래 소셜 로그인 관련 조항·개정 이력은 렌더되지 않고 직전 개정(2026-09-01) 상태 그대로 표시된다.
// 동의 원장 버전(`MINOR_CONSENT_VERSION` · legal-placeholder-2026-06-20) 승격은 법무 확정 후 별도 작업.
const REVISION_SOCIAL_LOGIN_EFFECTIVE_DATE: string = SOCIAL_LOGIN_REVISION_EFFECTIVE_DATE_LABEL;
const SOCIAL_LOGIN_REVISION_ACTIVE = SOCIAL_LOGIN_REVISION_ACTIVE_SHARED;
// 직전 개정(앱 푸시 알림 도입 고지)의 시행일 — 오너 확정(2026-08-27): 실가입자 없음(데모 계정만)에 따라 제12조 7일 사전 공지 기간 미적용.
const REVISION_2026_09_01 = "2026년 9월 1일";
// 그 전 개정(휴대폰 본인인증 도입) 시행일 — 제12조 이력 표기 전용.
const REVISION_2026_08_25 = "2026년 8월 25일";
// 현재 표시 시행일 — 소셜 로그인 개정 시행일이 채워지면 그 값, 아니면 직전 개정.
const REVISION_EFFECTIVE_DATE = SOCIAL_LOGIN_REVISION_ACTIVE ? REVISION_SOCIAL_LOGIN_EFFECTIVE_DATE : REVISION_2026_09_01;

/** 소셜 로그인 제공자별 제공 항목 (제1조 · 제4조 고지용). 사실관계 정본: DB-5 보고서 §2-5 · 4-4 지시서 §1. */
const SOCIAL_LOGIN_PROVIDER_ROWS: ReadonlyArray<{ provider: string; items: string }> = [
  { provider: "카카오", items: "계정 식별자, 닉네임, 이메일(이용자가 카카오 화면에서 제공에 동의한 경우에 한함)" },
  { provider: "구글", items: "계정 식별자, 이름, 이메일, 프로필 사진 URL" },
  { provider: "애플", items: "계정 식별자, 이름(최초 로그인 시 1회), 이메일 또는 애플이 발급하는 비공개 릴레이 주소" },
];

/** 제5조 ② 국외 이전 고지 표 (개인정보보호법 제28조의8 제1항 제3호). */
const OVERSEAS_TRANSFER_ROWS: ReadonlyArray<{ item: string; content: ReactNode }> = [
  {
    item: "이전받는 자",
    content: (
      <>
        Google LLC (1600 Amphitheatre Parkway, Mountain View, CA 94043, USA · 개인정보 문의:{" "}
        <a
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-[#2563EB] hover:underline"
        >
          https://policies.google.com/privacy
        </a>
        )
      </>
    ),
  },
  { item: "이전되는 국가", content: "미국 (Google이 운영하는 데이터센터 소재국을 포함)" },
  { item: "이전되는 개인정보 항목", content: "푸시 알림 토큰, 기기 플랫폼, 알림 메시지(제목·본문 및 알림 유형·식별자)" },
  { item: "이전 일시 및 방법", content: "알림 발생 시마다 암호화된 네트워크 통신(HTTPS)으로 전송" },
  { item: "이전받는 자의 이용 목적", content: "회사가 요청한 푸시 알림을 이용자 기기로 전달" },
  {
    item: "이전받는 자의 보유·이용 기간",
    content: "알림 전달 완료 시까지(기기가 오프라인인 경우 미전달 메시지는 최대 4주 보관 후 삭제). 토큰은 무효화 시까지",
  },
  {
    item: "이전을 거부하는 방법",
    content:
      "기기 설정에서 쌤버십 앱의 알림 권한을 끄거나, 앱 마이페이지 ▸ 설정에서 알림 수신을 해제할 수 있습니다. 거부 시 푸시 알림만 전송되지 않으며 앱 내 알림함 등 서비스 이용에는 제한이 없습니다",
  },
];

export default function LegalPrivacyPage() {
  return (
    <LegalDocLayout
      title="개인정보처리방침"
      effectiveDate={REVISION_EFFECTIVE_DATE}
      intro={
        <>
          {COMPANY.name}(이하 &lsquo;회사&rsquo;)은 「개인정보 보호법」 등 관련 법령을 준수하며, 이용자의 개인정보를 보호하기
          위해 다음과 같이 개인정보처리방침을 수립·공개합니다.
        </>
      }
    >
      <LegalSection title="제1조 (수집하는 개인정보 항목)">
        <p>회사는 서비스 제공을 위해 다음의 최소한의 개인정보를 수집합니다.</p>
        <LegalList
          items={[
            SOCIAL_LOGIN_REVISION_ACTIVE ? (
              <><strong>회원 공통(필수)</strong>: 이메일(소셜 로그인의 경우 제공자 설정 또는 이용자의 선택에 따라 수집되지 않을 수 있음), 비밀번호(이메일 가입 시 · 암호화 저장), 닉네임(표시명), 역할(학생/멘토), 생년월일, 서비스 이용기록</>
            ) : (
              <><strong>회원 공통(필수)</strong>: 이메일, 비밀번호(암호화 저장), 닉네임, 역할(학생/멘토), 서비스 이용기록</>
            ),
            ...(SOCIAL_LOGIN_REVISION_ACTIVE
              ? [
                  <>
                    <strong>소셜 로그인 시(필수)</strong>: 이용자가 선택한 소셜 로그인 제공자로부터 제공받는 다음 항목 —{" "}
                    {SOCIAL_LOGIN_PROVIDER_ROWS.map((row, index) => (
                      <span key={row.provider}>
                        {index > 0 ? " · " : ""}
                        <strong>{row.provider}</strong>: {row.items}
                      </span>
                    ))}
                    . 이메일은 제공자 설정 또는 이용자의 선택에 따라 수집되지 않을 수 있으며, 소셜 로그인으로 가입한 경우 비밀번호는
                    수집하지 않습니다
                  </>,
                ]
              : []),
            <><strong>학생(선택)</strong>: 학년 등 학습 지원에 필요한 정보</>,
            <><strong>멘토(필수)</strong>: 대학명·학과·담당 과목 등 프로필 정보, 재학 확인을 위한 학생증 이미지</>,
            <><strong>본인인증 시(필수)</strong>: 성명, 생년월일, 성별, 내·외국인 정보, 휴대폰번호, 이동통신사, 연계정보(CI), 중복가입확인정보(DI)</>,
            <><strong>만 14세 미만 회원의 법정대리인(필수)</strong>: 성명, 생년월일, 성별, 내·외국인 정보, 휴대폰번호, 이동통신사, 연계정보(CI), 중복가입확인정보(DI) — 법정대리인 본인인증(동의 확인) 과정에서 수집합니다</>,
            <><strong>결제 시</strong>: 결제 승인 정보·결제 내역(카드번호 등 민감 결제정보는 결제대행사가 처리하며 회사는 저장하지 않습니다)</>,
            <><strong>자동 생성·수집</strong>: 접속 로그, 기기·브라우저 정보, 서비스 이용 중 생성되는 질문·답변·정산·캐시 원장 등 거래기록</>,
            <><strong>앱 푸시 알림(자동 생성·수집)</strong>: 푸시 알림 토큰(앱이 설치된 기기를 식별하기 위해 Google Firebase가 발급하는 식별자), 기기 플랫폼(iOS/Android) — 모바일 앱에 로그인하면 자동으로 생성·수집되며, 기기의 알림 권한을 허용하지 않아도 앱 내 알림함 등 서비스 이용에는 영향이 없습니다</>,
          ]}
        />
        <p>
          본인인증 정보는 본인확인기관인 NICE평가정보(주)의 휴대폰 본인확인 서비스를 통해 수집하며, 회사는 이용자가
          본인확인기관에서 인증을 완료하는 시점에 그 결과를 제공받습니다.
        </p>
        {SOCIAL_LOGIN_REVISION_ACTIVE ? (
          <>
            <p>
              <strong>수집 방법</strong>: 회사는 다음의 방법으로 개인정보를 수집합니다.
            </p>
            <LegalList
              items={[
                "회원가입 화면 및 프로필 완성 화면에서 이용자가 직접 입력(역할, 표시명, 생년월일, 학생의 학년 또는 멘토의 대학·학과)",
                "소셜 로그인(OAuth) 과정에서 이용자가 제공자 화면에서 동의한 항목을 제공자로부터 전달받음 — 소셜 로그인으로 처음 가입한 이용자는 이어지는 프로필 완성 단계에서 위 항목을 직접 입력합니다",
                "휴대폰 본인인증 결과의 수신, 결제·서비스 이용 과정에서의 자동 생성·수집",
              ]}
            />
          </>
        ) : null}
      </LegalSection>

      <LegalSection title="제2조 (개인정보의 수집·이용 목적)">
        <LegalList
          items={[
            "회원 식별·인증 및 계정 관리, 멘토 자격 검증",
            "본인 확인 및 실명 인증, 연령 확인, 만 14세 미만 아동 가입 시 법정대리인 동의 확인",
            "중복 가입 및 부정 이용 방지, 유료 서비스 이용·환불 시 본인 확인",
            "질문방·개별질문·맞춤의뢰·커뮤니티 등 서비스 제공 및 멘토-학생 연결",
            "캐시 충전·결제·환불·정산 등 요금 처리",
            "고객 문의 대응, 공지·중요 안내 전달",
            "질문·답변·개별질문·구독 등 서비스 이용에 관한 알림의 앱 푸시 전송",
            "부정 이용 방지, 분쟁 조정, 서비스 안정성 확보 및 관련 법령상 의무 이행",
          ]}
        />
      </LegalSection>

      <LegalSection title="제3조 (개인정보의 보유 및 이용기간)">
        <p>
          회사는 원칙적으로 회원 탈퇴 시 개인정보를 지체 없이 파기하거나 익명화합니다. 다만 관련 법령에 따라 보존이 필요한
          경우 아래 기간 동안 해당 정보를 보관합니다.
        </p>
        <LegalList
          items={[
            "계약 또는 청약철회 등에 관한 기록: 5년 (전자상거래 등에서의 소비자보호에 관한 법률)",
            "대금결제 및 재화 등의 공급에 관한 기록: 5년 (동법)",
            "소비자의 불만 또는 분쟁처리에 관한 기록: 3년 (동법)",
            "서비스 접속 기록: 3개월 (통신비밀보호법)",
          ]}
        />
        <p>
          위 거래기록(결제·캐시 원장·정산·주문 등)은 개인을 식별할 수 없도록 익명 처리한 상태로 보존됩니다.
        </p>
        <p>
          본인인증 과정에서 수집한 정보(제1조의 본인인증 시 및 법정대리인 항목)는 회원 탈퇴 시 탈퇴 처리 과정에서
          지체 없이 파기합니다. 다만 관계 법령에 따라 보존 의무가 있는 기록은 위 보존 기간을 따릅니다.
        </p>
        <p>
          푸시 알림 토큰은 앱에서 로그아웃하거나 회원 탈퇴 시 즉시 무효화하며, 무효화된 토큰은 탈퇴 처리 과정에서
          지체 없이 파기합니다. 기기에서 앱을 삭제하거나 알림 수신을 거부한 경우 해당 토큰으로는 더 이상 알림이
          전송되지 않습니다.
        </p>
        {SOCIAL_LOGIN_REVISION_ACTIVE ? (
          <p>
            소셜 로그인 제공자로부터 제공받은 계정 식별자 및 항목(제1조의 소셜 로그인 시 항목)은 회원 탈퇴 시 탈퇴 처리
            과정에서 지체 없이 파기합니다. 다만 관계 법령에 따라 보존 의무가 있는 기록은 위 보존 기간을 따릅니다.
          </p>
        ) : null}
      </LegalSection>

      <LegalSection title="제4조 (개인정보의 제3자 제공)">
        <p>
          회사는 이용자의 개인정보를 본 방침에서 고지한 범위를 넘어 제3자에게 제공하지 않습니다. 다만 이용자가 사전에
          동의한 경우 또는 법령에 따라 요구되는 경우에 한하여 제공할 수 있습니다.
        </p>
        {SOCIAL_LOGIN_REVISION_ACTIVE ? (
          <>
            <p>
              <strong>소셜 로그인 제공자</strong>: 소셜 로그인(카카오·구글·애플)은 이용자가 각 제공자의 화면에서 정보 제공에
              동의하면 회사가 제공자로부터 제1조의 항목을 제공받는 방식이며, 회사가 이용자의 개인정보를 제공자에게 제공하거나
              처리를 위탁하는 것이 아닙니다. 회사는 로그인 처리에 필요한 범위를 넘어 제공자와 개인정보를 주고받지 않으며,
              제공자의 개인정보 처리는 각 제공자의 개인정보처리방침에 따릅니다.
            </p>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[420px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-300 text-left text-slate-600">
                    <th className="py-2 pr-4 font-semibold">제공자</th>
                    <th className="py-2 font-semibold">회사가 제공받는 항목</th>
                  </tr>
                </thead>
                <tbody>
                  {SOCIAL_LOGIN_PROVIDER_ROWS.map((row) => (
                    <tr key={row.provider} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-4 font-medium text-slate-800">{row.provider}</td>
                      <td className="py-2 text-slate-600">{row.items}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </LegalSection>

      <LegalSection title="제5조 (개인정보 처리의 위탁)">
        <p>① 회사는 원활한 서비스 제공을 위해 다음과 같이 개인정보 처리 업무를 위탁하고 있습니다.</p>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-600">
                <th className="py-2 pr-4 font-semibold">수탁업체</th>
                <th className="py-2 font-semibold">위탁 업무</th>
              </tr>
            </thead>
            <tbody>
              {PROCESSORS.map((p) => (
                <tr key={p.name} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-4 font-medium text-slate-800">{p.name}</td>
                  <td className="py-2 text-slate-600">{p.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          ② 회사는 앱 푸시 알림 전송을 위해 아래와 같이 개인정보 처리 업무를 국외 사업자에게 위탁하고 있습니다. 이는
          정보주체와의 서비스 이용계약 이행을 위한 처리위탁으로서, 개인정보보호법 제28조의8 제1항 제3호에 따라 본
          방침에 공개합니다.
        </p>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-600">
                <th className="py-2 pr-4 font-semibold">항목</th>
                <th className="py-2 font-semibold">내용</th>
              </tr>
            </thead>
            <tbody>
              {OVERSEAS_TRANSFER_ROWS.map((row) => (
                <tr key={row.item} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-4 font-medium text-slate-800">{row.item}</td>
                  <td className="py-2 text-slate-600">{row.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          회사는 위탁계약 시 개인정보가 안전하게 처리되도록 관련 법령에 따라 필요한 사항을 규정하고 관리·감독합니다.
        </p>
      </LegalSection>

      <LegalSection title="제6조 (이용자 및 법정대리인의 권리와 행사 방법)">
        <LegalList
          items={[
            "이용자는 언제든지 자신의 개인정보를 조회·수정할 수 있으며, 마이페이지에서 정보 수정 및 회원 탈퇴(개인정보 삭제)를 요청할 수 있습니다.",
            "만 14세 미만 아동의 법정대리인은 아동의 개인정보에 대한 열람·정정·삭제·처리정지를 요구할 수 있습니다.",
            "앱 푸시 알림은 기기 설정 또는 앱 내 설정에서 언제든지 수신을 거부하거나 다시 설정할 수 있습니다.",
            <>개인정보 관련 권리 행사는 아래 문의처(<a href={`mailto:${COMPANY.contactEmail}`} className="font-semibold text-[#2563EB] hover:underline">{COMPANY.contactEmail}</a>)를 통해서도 요청할 수 있으며, 회사는 지체 없이 조치합니다.</>,
          ]}
        />
      </LegalSection>

      <LegalSection title="제7조 (개인정보의 파기 절차 및 방법)">
        <LegalList
          items={[
            "보유기간이 경과하거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다.",
            "전자적 파일 형태의 정보는 복구·재생이 불가능한 방법으로 삭제하며, 법령상 보존이 필요한 정보는 개인을 식별할 수 없도록 익명 처리하여 분리 보관합니다.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제8조 (개인정보의 안전성 확보 조치)">
        <LegalList
          items={[
            "비밀번호 등 인증정보의 암호화 저장 및 전송 구간 암호화",
            "본인인증 정보 중 연계정보(CI)·중복가입확인정보(DI)·휴대폰번호는 중요한 식별정보로서 암호화하여 저장",
            "데이터베이스 접근 권한 통제 및 행 수준 보안(RLS) 등 접근 제어",
            "비정상 접근 탐지·차단 및 접속기록의 보관·점검",
            "푸시 알림 토큰은 회원 계정에 연결하여 저장하고, 발송 권한은 회사 서버에 한정하며 Google과의 전송은 암호화된 통신으로만 수행",
          ]}
        />
      </LegalSection>

      <LegalSection title="제9조 (만 14세 미만 아동의 개인정보)">
        <p>
          만 14세 미만 아동은 법정대리인의 동의를 확인한 후 서비스를 이용할 수 있습니다. 회사는 법정대리인의 동의를
          법정대리인 본인의 휴대폰 본인인증으로 확인하며, 이 과정에서 법정대리인의 개인정보(제1조의 법정대리인 항목)를
          수집합니다. 법정대리인의 동의가 확인되기 전까지 아동의 서비스 이용은 제한됩니다. 관련 안내는{" "}
          <Link href="/legal/minor-consent" className="font-semibold text-[#2563EB] hover:underline">만 14세 미만 보호자 동의</Link> 페이지를 참고하십시오.
        </p>
      </LegalSection>

      <LegalSection title="제10조 (쿠키 등 자동 수집 장치의 운영)">
        <p>
          회사는 로그인 세션 유지 등 서비스 제공에 필요한 범위에서 쿠키·세션 등 자동 수집 장치를 사용합니다. 이용자는
          브라우저 설정을 통해 쿠키 저장을 거부할 수 있으나, 이 경우 로그인 등 일부 서비스 이용이 제한될 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제11조 (개인정보 보호 문의)">
        <p>
          개인정보 처리에 관한 문의·불만·피해구제는 아래 창구로 접수하실 수 있으며, 회사는 신속하고 충분하게 답변·처리하겠습니다.
        </p>
        <LegalList
          items={[
            <>개인정보 문의: <a href={`mailto:${COMPANY.contactEmail}`} className="font-semibold text-[#2563EB] hover:underline">{COMPANY.contactEmail}</a></>,
            "기타 개인정보 침해에 대한 신고·상담은 개인정보분쟁조정위원회(1833-6972), 개인정보침해신고센터(118), 대검찰청(1301), 경찰청(182) 등에 문의할 수 있습니다.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제12조 (개인정보처리방침의 변경)">
        <p>
          법령·서비스의 변경에 따라 본 방침의 내용이 추가·삭제·수정되는 경우 회사는 변경 사항을 시행 최소 7일 전부터
          공지사항을 통해 고지합니다. 본 방침의 시행일 및 개정 이력은 다음과 같습니다.
        </p>
        <LegalList
          items={[
            <>{COMPANY.effectiveDate}: 시행</>,
            <>{REVISION_2026_08_25}: 개정 시행 — 휴대폰 본인인증(NICE평가정보) 도입에 따라 수집 항목·이용 목적·처리 위탁·안전성 확보 조치 및 만 14세 미만 아동의 개인정보 조항을 정비</>,
            <>{REVISION_2026_09_01}: 개정 시행 — 모바일 앱 푸시 알림(Firebase Cloud Messaging) 도입에 따라 수집 항목·이용 목적·보유기간·처리 위탁 및 국외 이전 고지, 이용자 권리·안전성 확보 조치를 보강</>,
            ...(SOCIAL_LOGIN_REVISION_ACTIVE
              ? [
                  <>{REVISION_SOCIAL_LOGIN_EFFECTIVE_DATE}: 개정 시행 — 소셜 로그인(카카오·구글·애플) 도입에 따라 수집 항목·수집 방법, 소셜 로그인 제공자에 관한 고지(제4조) 및 보유·파기 조항을 정비</>,
                ]
              : []),
          ]}
        />
      </LegalSection>
    </LegalDocLayout>
  );
}
