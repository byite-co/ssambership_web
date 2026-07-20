// 멘토 프로필 편집 payload 순수 빌더 — Supabase/Next 의존 없음.
//
// 목적: avatar(프로필 사진, `profile_image_url`)와 인증서류(학생증, `student_id_image_url`)의
// 컬럼 분리를 "코드"로 강제하고 계약 테스트(node:test)로 회귀를 막는다.
//   - 편집 payload 는 절대 인증서류 컬럼을 포함하지 않는다.
//   - avatar 는 새 URL 이 있을 때만 자기 컬럼만 갱신한다(문서 ref 불변).
//   - avatar 를 문서 fallback 으로 쓰지 않는다(서로 다른 ref 개념).
// 순수 함수라 `@/` alias·런타임 의존이 없어 `node --test --experimental-strip-types` 로 직접 검증 가능.

export type MentorProfilePayloadInput = {
  userId: string;
  intro: string;
  bio: string;
  grade: string;
  subjects: string;
  highSchool: string;
  tags: string;
  subscribeOpen: boolean;
  /** 프로필 사진(avatar) public URL. null/미입력이면 avatar 갱신 없음(기존 사진 유지). */
  profileImageUrl?: string | null;
};

export type MentorProfilePayloads = {
  /** mentor_profiles UPDATE 기본 컬럼(user_id 포함). 인증서류 컬럼은 절대 포함 안 함. */
  core: Record<string, unknown>;
  /** avatar 전용 패치. 새 URL 이 없으면 null(문서·기존 사진 불변). */
  imagePatch: { profile_image_url: string } | null;
  /** 스키마 편차 흡수용 순차 patch 후보(첫 성공에서 중단). */
  extras: Record<string, unknown>[];
};

// 프로필 편집 payload 에 절대 나타나면 안 되는 인증서류(민감 문서) 컬럼.
// 계약 테스트가 모든 payload 키를 이 목록과 대조해 교차 오염을 차단한다.
export const FORBIDDEN_DOCUMENT_COLUMNS = ["student_id_image_url"] as const;

export function splitCsv(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 편집 폼 입력 → mentor_profiles 컬럼 payload. 부수효과 없음.
 * `updateMentorProfile` 이 이 결과를 그대로 사용하므로, 계약 테스트가 실제 저장 경로를 검증한다.
 */
export function buildMentorProfilePayloads(
  input: MentorProfilePayloadInput,
): MentorProfilePayloads {
  const subjects = splitCsv(input.subjects);
  const tags = splitCsv(input.tags);

  // 학적 잠금: university_name·department_name 은 여기서 의도적으로 제외(학적변경요청 경로로만 반영).
  // 인증서류: student_id_image_url 은 편집 payload 에 절대 포함하지 않는다(별도 인증 페이지 전용).
  const core: Record<string, unknown> = {
    user_id: input.userId,
    intro_line: input.intro || null,
    bio: input.bio || null,
    teaching_subjects: subjects,
    high_school_name: input.highSchool || null,
  };

  const imagePatch = input.profileImageUrl
    ? { profile_image_url: input.profileImageUrl }
    : null;

  const extras: Record<string, unknown>[] = [
    {
      tags: tags.join(", "),
      featured_tags: tags,
      accept_subscriptions: input.subscribeOpen,
      accepts_subscriptions: input.subscribeOpen,
      is_open_for_subscriptions: input.subscribeOpen,
      grade: input.grade || null,
      grade_level: input.grade || null,
      academic_year: input.grade || null,
    },
    { tags, featured_tags: tags.join(", ") },
    { grade: input.grade || null },
    { grade_level: input.grade || null },
  ];

  return { core, imagePatch, extras };
}

/** payload 전체 키에서 금지된 인증서류 컬럼을 찾아 반환(없으면 빈 배열). 계약 검증용. */
export function findForbiddenDocumentKeys(payloads: MentorProfilePayloads): string[] {
  const forbidden = new Set<string>(FORBIDDEN_DOCUMENT_COLUMNS);
  const hits: string[] = [];
  const objs: Record<string, unknown>[] = [payloads.core, ...payloads.extras];
  if (payloads.imagePatch) objs.push(payloads.imagePatch);
  for (const obj of objs) {
    for (const key of Object.keys(obj)) {
      if (forbidden.has(key)) hits.push(key);
    }
  }
  return hits;
}
