CREATE TYPE "CementGrade" AS ENUM ('M500', 'M600');

ALTER TABLE "BarrelOperation"
  ADD COLUMN "grade" "CementGrade" NOT NULL DEFAULT 'M500';

ALTER TABLE "Shift"
  ADD COLUMN "grade" "CementGrade" NOT NULL DEFAULT 'M500';

ALTER TABLE "CementSale"
  ADD COLUMN "grade" "CementGrade" NOT NULL DEFAULT 'M500';
