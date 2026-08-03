-- Keep every real shift and sale, but restore the owner-confirmed packaging
-- totals per cement grade. Historical entries are only the balancing part.
WITH targets("grade", "produced") AS (
  VALUES
    ('M500'::"CementGrade", 1036),
    ('M600'::"CementGrade", 2947)
),
shift_totals AS (
  SELECT "grade", COALESCE(SUM("bags"), 0)::INTEGER AS "produced"
  FROM "Shift"
  GROUP BY "grade"
),
other_historical_totals AS (
  SELECT "grade", COALESCE(SUM("producedBags"), 0)::INTEGER AS "produced"
  FROM "HistoricalBagEntry"
  WHERE "date" <> '2026-07-20T12:00:00.000Z'
  GROUP BY "grade"
)
UPDATE "HistoricalBagEntry" AS historical
SET "producedBags" = GREATEST(
  0,
  targets."produced"
    - COALESCE(shift_totals."produced", 0)
    - COALESCE(other_historical_totals."produced", 0)
)
FROM targets
LEFT JOIN shift_totals ON shift_totals."grade" = targets."grade"
LEFT JOIN other_historical_totals
  ON other_historical_totals."grade" = targets."grade"
WHERE historical."grade" = targets."grade"
  AND historical."date" = '2026-07-20T12:00:00.000Z';

INSERT INTO "HistoricalBagEntry" ("date", "grade", "producedBags", "soldBags")
SELECT
  '2026-07-20T12:00:00.000Z',
  targets."grade",
  GREATEST(
    0,
    targets."produced"
      - COALESCE(shift_totals."produced", 0)
      - COALESCE(other_historical_totals."produced", 0)
  ),
  0
FROM (
  VALUES
    ('M500'::"CementGrade", 1036),
    ('M600'::"CementGrade", 2947)
) AS targets("grade", "produced")
LEFT JOIN (
  SELECT "grade", COALESCE(SUM("bags"), 0)::INTEGER AS "produced"
  FROM "Shift"
  GROUP BY "grade"
) AS shift_totals ON shift_totals."grade" = targets."grade"
LEFT JOIN (
  SELECT "grade", COALESCE(SUM("producedBags"), 0)::INTEGER AS "produced"
  FROM "HistoricalBagEntry"
  WHERE "date" <> '2026-07-20T12:00:00.000Z'
  GROUP BY "grade"
) AS other_historical_totals
  ON other_historical_totals."grade" = targets."grade"
WHERE NOT EXISTS (
  SELECT 1
  FROM "HistoricalBagEntry" historical
  WHERE historical."grade" = targets."grade"
    AND historical."date" = '2026-07-20T12:00:00.000Z'
);
