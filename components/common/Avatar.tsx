import type { CSSProperties } from "react";

/**
 * 공용 아바타 — 이름 기반 이니셜 + 색.
 * - role 지정 시 역할 고정색(멘토=초록, 학생=파랑) — House Style 역할 아바타 규칙.
 * - role 미지정 시 이름 해시로 브랜드 톤(쿨톤) 파스텔 자동 배정(보라·핑크·남색·주황 제외).
 * - photo 있으면 사진 우선, 로드 실패 시 이니셜 폴백.
 */

type AvatarRole = "mentor" | "student";

type Tone = { bg: string; fg: string };

const ROLE_TONE: Record<AvatarRole, Tone> = {
  mentor: { bg: "#ECFDF5", fg: "#047857" }, // 초록(멘토)
  student: { bg: "#EFF4FF", fg: "#1E429F" }, // 파랑(학생/기본)
};

// 이름 해시용 브랜드 안전 파스텔(쿨톤만): 파랑/스카이/시안/틸/에메랄드/슬레이트
const HASH_TONES: readonly Tone[] = [
  { bg: "#EFF4FF", fg: "#1E429F" },
  { bg: "#E0F2FE", fg: "#075985" },
  { bg: "#CFFAFE", fg: "#155E75" },
  { bg: "#CCFBF1", fg: "#115E59" },
  { bg: "#ECFDF5", fg: "#047857" },
  { bg: "#F1F5F9", fg: "#334155" },
];

function hashTone(seed: string): Tone {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return HASH_TONES[h % HASH_TONES.length];
}

function initialOf(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  return n ? n.slice(0, 1) : "쌤";
}

export function Avatar(props: {
  name?: string | null;
  role?: AvatarRole;
  photo?: string | null;
  /** 지름·글자 크기 Tailwind 클래스. 기본 h-10 w-10 text-sm */
  className?: string;
  ring?: boolean;
}) {
  const tone = props.role ? ROLE_TONE[props.role] : hashTone(props.name ?? "");
  const sizeClass = props.className ?? "h-10 w-10 text-sm";
  const style: CSSProperties = { backgroundColor: tone.bg, color: tone.fg };

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-black ${
        props.ring ? "ring-1 ring-black/5" : ""
      } ${sizeClass}`}
      style={style}
      aria-hidden
    >
      <span className="absolute inset-0 flex items-center justify-center">{initialOf(props.name)}</span>
      {props.photo ? (
        // 사용자 업로드/외부 아바타 URL(remote pattern 불특정) — next/image 미적용, 첨부 렌더와 동일 관례
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={props.photo}
          alt=""
          className="relative h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </span>
  );
}
