ALTER TYPE "ExpenseCategory" ADD VALUE 'BULK_SALARY';

ALTER TABLE "Expense"
  ADD COLUMN "materialSaleId" INTEGER;

CREATE UNIQUE INDEX "Expense_materialSaleId_key"
  ON "Expense"("materialSaleId");

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_materialSaleId_fkey"
  FOREIGN KEY ("materialSaleId")
  REFERENCES "MaterialSale"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
