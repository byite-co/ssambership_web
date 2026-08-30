// 페이싱크 웹훅 서명 검증 계약 (Phase 1):
//   * 정본 https://docs.paysync.kr/api-reference/webhooks/overview.md §4 와 일치.
//   * 시크릿 형식 오류를 서명 불일치와 **다른 사유**로 구분한다(env 오설정 추적용).
//   * 원본 바디 그대로 서명한다 — 재직렬화하면 실패해야 한다.
//   * 타임스탬프 ±300초 윈도우, 키 로테이션(복수 서명) 지원.
// 실행: node --test --experimental-strip-types lib/paysync/__contract__/paysyncWebhookSignature.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  buildPaysyncSignedContent,
  decodePaysyncWebhookSecret,
  parsePaysyncSignatureCandidates,
  PAYSYNC_TIMESTAMP_TOLERANCE_SECONDS,
  verifyPaysyncSignature,
} from "../verifyPaysyncWebhookSignature.ts";

const KEY_BYTES = Buffer.alloc(32, 7);
const SECRET = `whsec_${KEY_BYTES.toString("base64")}`;
const WEBHOOK_ID = "whm_01hxyz0123456789abcdef";
const NOW = 1_800_000_000;
const BODY = JSON.stringify({ type: "invoice.paid", invoice: { id: "ivc_abc", amount: 30000 } });

function sign(body: string, id = WEBHOOK_ID, ts = String(NOW), key = KEY_BYTES): string {
  return crypto.createHmac("sha256", key).update(buildPaysyncSignedContent(id, ts, body), "utf8").digest("base64");
}

function input(over: Partial<Parameters<typeof verifyPaysyncSignature>[0]> = {}) {
  return {
    rawBody: BODY,
    webhookId: WEBHOOK_ID,
    webhookTimestamp: String(NOW),
    webhookSignature: `v1,${sign(BODY)}`,
    secret: SECRET,
    nowSeconds: NOW,
    ...over,
  };
}

test("정상: 문서 규칙대로 만든 서명은 통과하고 id·timestamp 를 돌려준다", () => {
  const v = verifyPaysyncSignature(input());
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.webhookId, WEBHOOK_ID);
    assert.equal(v.timestampSeconds, NOW);
  }
});

test("서명 대상 문자열은 `id.timestamp.body` 다", () => {
  assert.equal(buildPaysyncSignedContent("a", "1", "{}"), "a.1.{}");
});

test("시크릿 형식: whsec_ + base64 만 키로 인정한다", () => {
  assert.ok(decodePaysyncWebhookSecret(SECRET));
  // 접두사 없음
  assert.equal(decodePaysyncWebhookSecret(KEY_BYTES.toString("base64")), null);
  // base64 아님(공백·기호)
  assert.equal(decodePaysyncWebhookSecret("whsec_not base64!!"), null);
  // 너무 짧은 키
  assert.equal(decodePaysyncWebhookSecret(`whsec_${Buffer.alloc(4, 1).toString("base64")}`), null);
  assert.equal(decodePaysyncWebhookSecret(""), null);
  assert.equal(decodePaysyncWebhookSecret(null), null);
});

test("env 오설정은 signature_mismatch 가 아니라 secret_* 사유로 구분된다", () => {
  // 미설정
  assert.deepEqual(verifyPaysyncSignature(input({ secret: "" })), { ok: false, reason: "secret_missing" });
  assert.deepEqual(verifyPaysyncSignature(input({ secret: null })), { ok: false, reason: "secret_missing" });
  // 엔드포인트 URL 을 시크릿 칸에 넣은 실제 오설정 형태 — Node 의 관대한 base64 디코더가
  // 쓰레기 키를 만들어 mismatch 로 위장하는 것을 막는다.
  assert.deepEqual(
    verifyPaysyncSignature(input({ secret: "https://example-3000.app.github.dev/" })),
    { ok: false, reason: "secret_malformed" },
  );
  assert.deepEqual(
    verifyPaysyncSignature(input({ secret: "whsec_짧음" })),
    { ok: false, reason: "secret_malformed" },
  );
});

test("헤더 누락은 headers_missing", () => {
  for (const over of [{ webhookId: "" }, { webhookTimestamp: "" }, { webhookSignature: "" }]) {
    assert.deepEqual(verifyPaysyncSignature(input(over)), { ok: false, reason: "headers_missing" });
  }
  assert.deepEqual(verifyPaysyncSignature(input({ webhookId: null })), { ok: false, reason: "headers_missing" });
});

test("타임스탬프: 정수 아님 → invalid, ±300초 경계 밖 → out_of_window", () => {
  assert.deepEqual(verifyPaysyncSignature(input({ webhookTimestamp: "abc" })), {
    ok: false,
    reason: "timestamp_invalid",
  });
  assert.deepEqual(verifyPaysyncSignature(input({ webhookTimestamp: "17.5" })), {
    ok: false,
    reason: "timestamp_invalid",
  });

  const edge = PAYSYNC_TIMESTAMP_TOLERANCE_SECONDS;
  // 경계값(정확히 300초)은 통과 — 서명도 그 timestamp 로 다시 만들어야 한다.
  for (const skew of [edge, -edge]) {
    const ts = String(NOW + skew);
    const v = verifyPaysyncSignature(
      input({ webhookTimestamp: ts, webhookSignature: `v1,${sign(BODY, WEBHOOK_ID, ts)}` }),
    );
    assert.equal(v.ok, true, `skew ${skew} 는 통과해야 한다`);
  }
  // 301초는 거부
  for (const skew of [edge + 1, -(edge + 1)]) {
    const ts = String(NOW + skew);
    assert.deepEqual(
      verifyPaysyncSignature(input({ webhookTimestamp: ts, webhookSignature: `v1,${sign(BODY, WEBHOOK_ID, ts)}` })),
      { ok: false, reason: "timestamp_out_of_window" },
      `skew ${skew} 는 거부해야 한다`,
    );
  }
});

test("서명 헤더 파싱: v1 항목만 인정하고 공백 구분 복수 서명을 지원한다", () => {
  assert.deepEqual(parsePaysyncSignatureCandidates("v1,aaa"), ["aaa"]);
  assert.deepEqual(parsePaysyncSignatureCandidates("v1,aaa v1,bbb"), ["aaa", "bbb"]);
  // v2 등 미래 버전은 v1 키로 검증하지 않는다.
  assert.deepEqual(parsePaysyncSignatureCandidates("v2,aaa"), []);
  assert.deepEqual(parsePaysyncSignatureCandidates("aaa"), []);
  assert.deepEqual(parsePaysyncSignatureCandidates(""), []);
  assert.deepEqual(parsePaysyncSignatureCandidates(null), []);
});

test("v1 항목이 없으면 signature_malformed, 값이 틀리면 signature_mismatch", () => {
  assert.deepEqual(verifyPaysyncSignature(input({ webhookSignature: "garbage" })), {
    ok: false,
    reason: "signature_malformed",
  });
  assert.deepEqual(verifyPaysyncSignature(input({ webhookSignature: `v2,${sign(BODY)}` })), {
    ok: false,
    reason: "signature_malformed",
  });
  // 다른 키로 서명 → 불일치
  assert.deepEqual(
    verifyPaysyncSignature(input({ webhookSignature: `v1,${sign(BODY, WEBHOOK_ID, String(NOW), Buffer.alloc(32, 9))}` })),
    { ok: false, reason: "signature_mismatch" },
  );
});

test("키 로테이션: 복수 서명 중 하나만 맞아도 통과, 전부 틀리면 거부", () => {
  const good = sign(BODY);
  const bad = sign(BODY, WEBHOOK_ID, String(NOW), Buffer.alloc(32, 9));
  assert.equal(verifyPaysyncSignature(input({ webhookSignature: `v1,${bad} v1,${good}` })).ok, true);
  assert.equal(verifyPaysyncSignature(input({ webhookSignature: `v1,${good} v1,${bad}` })).ok, true);
  assert.equal(verifyPaysyncSignature(input({ webhookSignature: `v1,${bad} v1,${bad}` })).ok, false);
});

test("바디 변조·재직렬화는 실패한다 (원본 바디 계약)", () => {
  // 한 글자만 바뀌어도 불일치
  assert.deepEqual(verifyPaysyncSignature(input({ rawBody: `${BODY} ` })), {
    ok: false,
    reason: "signature_mismatch",
  });
  // JSON 파싱 후 키 순서를 바꿔 재직렬화하면 서명이 깨진다 — 라우트가 req.text() 를
  // 그대로 넘겨야 하는 이유.
  const reserialized = JSON.stringify({ invoice: { amount: 30000, id: "ivc_abc" }, type: "invoice.paid" });
  assert.notEqual(reserialized, BODY);
  assert.deepEqual(verifyPaysyncSignature(input({ rawBody: reserialized })), {
    ok: false,
    reason: "signature_mismatch",
  });
});

test("길이가 다른 서명 후보에서 throw 하지 않는다(timingSafeEqual 함정)", () => {
  // 문서의 Node 예제는 길이 검사 없이 timingSafeEqual 을 호출해 throw 한다.
  assert.doesNotThrow(() => verifyPaysyncSignature(input({ webhookSignature: "v1,YWJj" })));
  assert.deepEqual(verifyPaysyncSignature(input({ webhookSignature: "v1,YWJj" })), {
    ok: false,
    reason: "signature_mismatch",
  });
  // base64 가 아닌 값도 사유가 mismatch 여야 한다(예외 아님).
  assert.doesNotThrow(() => verifyPaysyncSignature(input({ webhookSignature: "v1,!!!!" })));
});

test("검사 순서: 시크릿 오류가 헤더·타임스탬프 오류보다 먼저 보고된다", () => {
  // 전부 망가진 요청에서도 설정 문제를 먼저 알려야 운영 중 원인 추적이 어긋나지 않는다.
  assert.deepEqual(
    verifyPaysyncSignature(input({ secret: "not-a-secret", webhookId: "", webhookTimestamp: "abc" })),
    { ok: false, reason: "secret_malformed" },
  );
});
