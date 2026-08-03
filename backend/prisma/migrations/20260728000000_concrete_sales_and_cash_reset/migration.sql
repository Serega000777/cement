CREATE TABLE "ConcreteSale" (
  "id" SERIAL PRIMARY KEY,
  "date" TIMESTAMP(3) NOT NULL,
  "concreteGrade" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "volume" DECIMAL(12,3) NOT NULL,
  "pricePerM3" DECIMAL(14,2) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Start a new cash period without changing historical income or expense records.
INSERT INTO "CashCollection" ("amount", "createdAt")
VALUES (0, CURRENT_TIMESTAMP);
