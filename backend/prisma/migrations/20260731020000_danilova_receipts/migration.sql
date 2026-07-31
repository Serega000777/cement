CREATE TABLE "DanilovaReceipt" (
  "id" SERIAL NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "vehicle" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "concreteGrade" TEXT NOT NULL,
  "volume" DECIMAL(12,3) NOT NULL,
  "pricePerM3" DECIMAL(14,2) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "paid" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DanilovaReceipt_pkey" PRIMARY KEY ("id")
);
