import Image from "next/image";
import Link from "next/link";

/** 확정 브랜드 심볼(파란 사각 + 졸업모자·말풍선). 워드마크 좌측에 항상 함께 렌더링한다. */
export const BRAND_LOGO_SRC = "/brand/ssambership-logo.svg";

export function BrandSymbol({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <Image
      src={BRAND_LOGO_SRC}
      alt=""
      width={32}
      height={32}
      className={`shrink-0 ${className}`}
      aria-hidden
    />
  );
}

type BrandLogoProps = {
  href?: string;
  className?: string;
  variant?: "landing" | "shell";
  onClick?: () => void;
};

export function BrandLogo({ href = "/", className = "", variant = "landing", onClick }: BrandLogoProps) {
  const textClass =
    variant === "landing"
      ? "text-[18px] font-black tracking-tight text-[#142d61] sm:text-[20px]"
      : "text-lg font-black tracking-tight text-[#142d61] sm:text-xl";

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex min-w-fit shrink-0 items-center gap-2 whitespace-nowrap ${className}`}
    >
      <BrandSymbol />
      <span className={textClass}>쌤버십</span>
    </Link>
  );
}
