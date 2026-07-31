ALTER TYPE "ExpenseCategory" ADD VALUE IF NOT EXISTS 'DELIVERY';

CREATE TABLE "ExpenseCategoryOption" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpenseCategoryOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpenseCategoryOption_name_key" ON "ExpenseCategoryOption"("name");

ALTER TABLE "Expense" ADD COLUMN "customCategoryId" INTEGER;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_customCategoryId_fkey"
  FOREIGN KEY ("customCategoryId") REFERENCES "ExpenseCategoryOption"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
