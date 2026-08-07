/**
 * 조회수 멱등 event_key 공용 유틸 (D-CM-3 / D-CM-4).
 *
 * 게시판(community_post_view_record_v2)·숏폼(shortform_view_record_v2)의 조회 계수는
 * (게시글 + 뷰어 + 시간버킷)에서 **결정적으로 파생한** event_key 를 넘겨 같은 뷰어의 같은
 * 시간대 재조회(새로고침·재검증·프리페치·봇 크롤)를 한 번으로 접는다. 구 숏폼은 매 호출
 * crypto.randomUUID() 를 써 멱등 계약이 사실상 무력화됐고, 구 게시판은 event_key 없는 v1
 * (increment_community_post_view)이라 계수 조작에 무방비였다.
 *
 * 이 키는 암호학적 비밀이 아니라 **중복 제거 버킷 식별자**다. 브라우저·서버 양쪽에서 동기로
 * 동작해야 하므로 Web Crypto(async)가 아니라 결정적 128-bit 해시(cyrb128)로 UUID 형태
 * 문자열을 만든다. RPC 는 이 값을 UNIQUE(event_key)로만 사용한다.
 */

/** cyrb128 — 문자열 → 128-bit(4×32) 결정적 해시. 비암호. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}

/**
 * 부분들을 결합해 RFC-4122 형태(version 5, variant 8)의 결정적 UUID 문자열을 만든다.
 * 같은 입력 → 항상 같은 키, 다른 입력 → (해시 충돌 무시) 다른 키.
 */
export function deriveViewEventKey(parts: Array<string | null | undefined>): string {
  const seed = parts.map((p) => (p == null ? "" : String(p))).join("|");
  const [a, b, c, d] = cyrb128(seed);
  const h = hex8(a) + hex8(b) + hex8(c) + hex8(d); // 32 hex chars
  const v = "5" + h.slice(13, 16); // version 5 nibble
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${v}-${variant}-${h.slice(20, 32)}`;
}

/** UTC 시간 단위 버킷 문자열(YYYY-MM-DDTHH). 같은 시간대의 재조회를 한 이벤트로 접는다. */
export function hourBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 13);
}

/** 뷰어 식별자: 로그인 시 uid, 비로그인 시 클라이언트가 보관한 익명 세션 id. */
export function viewEventKeyFor(postId: string, viewerId: string | null | undefined, now: Date = new Date()): string {
  return deriveViewEventKey([postId, viewerId ?? "anon", hourBucket(now)]);
}
