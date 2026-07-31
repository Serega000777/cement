-- The 30 July sale was entered shortly before automatic bulk salary went live.
-- Backfill only current-period sales; older loading salary was already recorded
-- separately and must not be duplicated.
INSERT INTO "Expense" (
  "date",
  "category",
  "amount",
  "comment",
  "materialSaleId"
)
SELECT
  sale."date",
  'BULK_SALARY'::"ExpenseCategory",
  sale."tons" * 100,
  'Зарплата Беларусу за погрузку '
    || CASE WHEN sale."material" = 'SAND' THEN 'песка' ELSE 'щебня' END
    || ': ' || sale."tons" || ' т × 100 ₽',
  sale."id"
FROM "MaterialSale" sale
WHERE sale."createdAt" >= '2026-07-30T00:00:00.000Z'
  AND NOT EXISTS (
    SELECT 1
    FROM "Expense" expense
    WHERE expense."materialSaleId" = sale."id"
  );
