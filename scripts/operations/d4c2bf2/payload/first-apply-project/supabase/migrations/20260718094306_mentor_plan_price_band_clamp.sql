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