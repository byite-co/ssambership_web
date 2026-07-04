import Link from "next/link";
import { BrandLogo } from "@/components/brand/BrandLogo";

type FooterLink = { label: string; href: string; emphasis?: boolean };

// 사업자등록번호: 기본값 실번호(항상 표시), 환경변수로 override 가능.
const BUSINESS_NO = (process.env.NEXT_PUBLIC_BUSINESS_NO ?? "320-86-03865").trim();

const SERVICE_LINKS: FooterLink[] = [
  { label: "멘토 찾기", href: "/mentors" },
  { label: "질문방", href: "/question-room" },
  { label: "커뮤니티", href: "/community" },
];

const SUPPORT_LINKS: FooterLink[] = [
  { label: "자주 묻는 질문", href: "/support" },
  { label: "공지사항", href: "/notices" },
  { label: "고객센터", href: "/support#contact" },
  { label: "서비스 소개", href: "/" },
];

const MENTOR_LINKS: FooterLink[] = [
  { label: "멘토 가입하기", href: "/signup" },
  { label: "멘토 가이드", href: "/legal/mentor-guide" },
  { label: "정산 안내", href: "/legal/payout-guide" },
];

const LEGAL_LINKS: FooterLink[] = [
  { label: "이용약관", href: "/legal/terms" },
  { label: "개인정보처리방침", href: "/legal/privacy", emphasis: true },
  { label: "환불 정책", href: "/legal/refund" },
  { label: "고객센터", href: "/support#contact" },
];

function FooterColumn(props: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <p className="text-sm font-black text-slate-900">{props.title}</p>
      <ul className="mt-3 space-y-2">
        {props.links.map((link) => (
          <li key={link.label}>
            <Link
              href={link.href}
              className="text-sm font-medium text-slate-600 transition hover:text-[#2563EB]"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[#E2E8F0] bg-white" role="contentinfo">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          <div>
            <BrandLogo href="/" variant="shell" />
            <p className="mt-4 max-w-xs text-sm font-medium leading-relaxed text-slate-600">
              전국 현직 대학생 멘토와 1:1로 연결되어 질문하고, 배우고, 함께 성장하세요.
            </p>
          </div>
          <FooterColumn title="서비스" links={SERVICE_LINKS} />
          <FooterColumn title="고객 지원" links={SUPPORT_LINKS} />
          <FooterColumn title="멘토 지원" links={MENTOR_LINKS} />
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-[#E2E8F0] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <nav className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm text-slate-600" aria-label="약관 및 정책">
            {LEGAL_LINKS.map((link, index) => (
              <span key={link.label} className="inline-flex items-center">
                {index > 0 ? (
                  <span className="mx-2 text-slate-300" aria-hidden>
                    ·
                  </span>
                ) : null}
                <Link
                  href={link.href}
                  className={`transition hover:text-[#2563EB] ${link.emphasis ? "font-medium" : "font-normal"}`}
                >
                  {link.label}
                </Link>
              </span>
            ))}
          </nav>
          <p className="text-xs font-medium text-slate-500">
            (주)바이트{BUSINESS_NO ? ` | 사업자등록번호: ${BUSINESS_NO}` : ""}
          </p>
        </div>
      </div>
    </footer>
  );
}
