DELETE FROM "HistoricalBagEntry";

INSERT INTO "HistoricalBagEntry" ("date", "grade", "producedBags", "soldBags")
SELECT
  '2026-07-20T12:00:00.000Z',
  grade::"CementGrade",
  GREATEST(0, target_produced - actual_produced),
  GREATEST(0, target_sold - actual_sold)
FROM (
  SELECT
    'M500' AS grade,
    1036 AS target_produced,
    106 AS target_sold,
    COALESCE((SELECT SUM("bags") FROM "Shift" WHERE "grade" = 'M500'), 0)::INTEGER AS actual_produced,
    COALESCE((SELECT SUM("bags") FROM "CementSale" WHERE "grade" = 'M500'), 0)::INTEGER AS actual_sold
  UNION ALL
  SELECT
    'M600',
    2947,
    2690,
    COALESCE((SELECT SUM("bags") FROM "Shift" WHERE "grade" = 'M600'), 0)::INTEGER,
    COALESCE((SELECT SUM("bags") FROM "CementSale" WHERE "grade" = 'M600'), 0)::INTEGER
) totals;

WITH salary_totals AS (
  SELECT
    COALESCE(SUM("packagingPay"), 0) AS packaging_total,
    COALESCE(SUM("loadingPay"), 0) AS loading_total,
    COUNT(*) AS shift_count
  FROM "Shift"
  WHERE "date" >= '2026-07-21T00:00:00.000Z'
)
UPDATE "Shift"
SET
  "packagingPay" = CASE
    WHEN salary_totals.packaging_total > 0
      THEN "Shift"."packagingPay" * 87500 / salary_totals.packaging_total
    ELSE 87500 / NULLIF(salary_totals.shift_count, 0)
  END,
  "loadingPay" = CASE
    WHEN salary_totals.loading_total > 0
      THEN "Shift"."loadingPay" * 3700 / salary_totals.loading_total
    ELSE 3700 / NULLIF(salary_totals.shift_count, 0)
  END
FROM salary_totals
WHERE "Shift"."date" >= '2026-07-21T00:00:00.000Z';

UPDATE "ShiftWorker" sw
SET "salary" = (
  SELECT (s."packagingPay" + s."loadingPay") / NULLIF(COUNT(*), 0)
  FROM "Shift" s
  JOIN "ShiftWorker" all_workers ON all_workers."shiftId" = s."id"
  WHERE s."id" = sw."shiftId"
  GROUP BY s."id", s."packagingPay", s."loadingPay"
)
WHERE sw."shiftId" IN (
  SELECT "id" FROM "Shift" WHERE "date" >= '2026-07-21T00:00:00.000Z'
);
