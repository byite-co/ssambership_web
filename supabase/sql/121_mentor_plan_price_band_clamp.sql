-- 121_mentor_plan_price_band_clamp.sql
-- 개정 2026-07-18 (권장가 하향): 권장가를 라이트 29,900 · 스탠다드 84,900 · 프리미엄 174,900으로
-- 변경하고(min = 권장가), 멘토 가격 저장 시 밴드를 서버에서 강제하도록 앱을 수정했다.
-- 이 스크립트는 그 이전에 밴드 밖으로 저장된 기존 mentor_plans 행을 새 밴드로 클램프한다.
-- (min 미만 → min, max 초과 → max. 밴드 안 값은 멘토 설정 존중 — 변경 없음. 멱등.)
--
-- 새 밴드(캐시, amount_cents = 캐시 × 100):
--   limited  29,900 ~ 69,900   (2,990,000 ~ 6,990,000)
--   standard 84,900 ~ 149,900  (8,490,000 ~ 14,990,000)
--   premium 174,900 ~ 329,900 (17,490,000 ~ 32,990,000)

WITH band AS (
  SELECT * FROM (VALUES
    ('limited',  2990000,  6990000),
    ('standard', 8490000, 14990000),
    ('premium', 17490000, 32990000)
  ) AS t(plan_tier, min_cents, max_cents)
)
UPDATE mentor_plans mp
SET amount_cents = LEAST(GREATEST(mp.amount_cents, b.min_cents), b.max_cents),
    updated_at = now(),
    price_updated_at = now()
FROM band b
WHERE mp.plan_tier = b.plan_tier
  AND (mp.amount_cents < b.min_cents OR mp.amount_cents > b.max_cents);
