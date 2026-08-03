CREATE TABLE "CashAdjustment" (
  "id" SERIAL PRIMARY KEY,
  "date" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "note" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "CashAdjustment" ("date", "amount", "note")
SELECT
  '2026-07-21T12:00:00.000Z',
  252650 - COALESCE((
    SELECT SUM("amount")
    FROM "CementSale"
    WHERE "date" >= '2026-07-21T00:00:00.000Z'
  ), 0),
  'Корректировка дохода 21–25.07: М600 363×550, М500 106×500'
WHERE 252650 - COALESCE((
  SELECT SUM("amount")
  FROM "CementSale"
  WHERE "date" >= '2026-07-21T00:00:00.000Z'
), 0) <> 0;

INSERT INTO "CashAdjustment" ("date", "amount", "note")
SELECT
  '2026-07-21T12:00:00.000Z',
  -(73500 - COALESCE((
    SELECT SUM("amount")
    FROM "Expense"
    WHERE "date" >= '2026-07-21T00:00:00.000Z'
      AND "category" <> 'SALARY'
  ), 0)),
  'Корректировка расходов 21–25.07: топливо 71500, прочее 2000'
WHERE 73500 - COALESCE((
  SELECT SUM("amount")
  FROM "Expense"
  WHERE "date" >= '2026-07-21T00:00:00.000Z'
    AND "category" <> 'SALARY'
), 0) <> 0;
