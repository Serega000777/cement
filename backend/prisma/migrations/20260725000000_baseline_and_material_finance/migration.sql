ALTER TABLE "MaterialSale"
  ADD COLUMN "includeInFinance" BOOLEAN NOT NULL DEFAULT false;

DELETE FROM "HistoricalBagEntry";

INSERT INTO "HistoricalBagEntry" ("date", "grade", "producedBags", "soldBags")
VALUES
  ('2026-07-20T12:00:00.000Z', 'M500', 1036, 106),
  ('2026-07-20T12:00:00.000Z', 'M600', 2947, 2690);
