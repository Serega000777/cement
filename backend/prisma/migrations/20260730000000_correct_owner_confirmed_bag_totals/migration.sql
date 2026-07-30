-- Restore the latest owner-confirmed cumulative bag totals without deleting
-- any real shifts or sales. The 20 July rows remain balancing entries only.
WITH targets("grade", "produced", "sold") AS (
  VALUES
    ('M500'::"CementGrade", 1036, 187),
    ('M600'::"CementGrade", 3147, 2695)
),
live_totals AS (
  SELECT
    targets."grade",
    COALESCE((
      SELECT SUM(shift."bags")
      FROM "Shift" shift
      WHERE shift."grade" = targets."grade"
    ), 0)::INTEGER AS "produced",
    COALESCE((
      SELECT SUM(sale."bags")
      FROM "CementSale" sale
      WHERE sale."grade" = targets."grade"
    ), 0)::INTEGER AS "sold",
    COALESCE((
      SELECT SUM(history."producedBags")
      FROM "HistoricalBagEntry" history
      WHERE history."grade" = targets."grade"
        AND history."date" <> '2026-07-20T12:00:00.000Z'
    ), 0)::INTEGER AS "otherProduced",
    COALESCE((
      SELECT SUM(history."soldBags")
      FROM "HistoricalBagEntry" history
      WHERE history."grade" = targets."grade"
        AND history."date" <> '2026-07-20T12:00:00.000Z'
    ), 0)::INTEGER AS "otherSold"
  FROM targets
)
UPDATE "HistoricalBagEntry" history
SET
  "producedBags" = GREATEST(
    0,
    targets."produced" - live_totals."produced" - live_totals."otherProduced"
  ),
  "soldBags" = GREATEST(
    0,
    targets."sold" - live_totals."sold" - live_totals."otherSold"
  )
FROM targets
JOIN live_totals ON live_totals."grade" = targets."grade"
WHERE history."grade" = targets."grade"
  AND history."date" = '2026-07-20T12:00:00.000Z';

WITH targets("grade", "produced", "sold") AS (
  VALUES
    ('M500'::"CementGrade", 1036, 187),
    ('M600'::"CementGrade", 3147, 2695)
),
live_totals AS (
  SELECT
    targets."grade",
    COALESCE((
      SELECT SUM(shift."bags")
      FROM "Shift" shift
      WHERE shift."grade" = targets."grade"
    ), 0)::INTEGER AS "produced",
    COALESCE((
      SELECT SUM(sale."bags")
      FROM "CementSale" sale
      WHERE sale."grade" = targets."grade"
    ), 0)::INTEGER AS "sold",
    COALESCE((
      SELECT SUM(history."producedBags")
      FROM "HistoricalBagEntry" history
      WHERE history."grade" = targets."grade"
        AND history."date" <> '2026-07-20T12:00:00.000Z'
    ), 0)::INTEGER AS "otherProduced",
    COALESCE((
      SELECT SUM(history."soldBags")
      FROM "HistoricalBagEntry" history
      WHERE history."grade" = targets."grade"
        AND history."date" <> '2026-07-20T12:00:00.000Z'
    ), 0)::INTEGER AS "otherSold"
  FROM targets
)
INSERT INTO "HistoricalBagEntry" (
  "date",
  "grade",
  "producedBags",
  "soldBags"
)
SELECT
  '2026-07-20T12:00:00.000Z',
  targets."grade",
  GREATEST(
    0,
    targets."produced" - live_totals."produced" - live_totals."otherProduced"
  ),
  GREATEST(
    0,
    targets."sold" - live_totals."sold" - live_totals."otherSold"
  )
FROM targets
JOIN live_totals ON live_totals."grade" = targets."grade"
WHERE NOT EXISTS (
  SELECT 1
  FROM "HistoricalBagEntry" history
  WHERE history."grade" = targets."grade"
    AND history."date" = '2026-07-20T12:00:00.000Z'
);
