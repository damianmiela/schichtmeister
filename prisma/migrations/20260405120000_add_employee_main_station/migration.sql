-- AlterTable: Add mainStation column (nullable)
ALTER TABLE "Employee" ADD COLUMN "mainStation" INTEGER;

-- Backfill: If employee has exactly one assignedStation, use it as mainStation
UPDATE "Employee"
SET "mainStation" = "assignedStations"[1]
WHERE array_length("assignedStations", 1) = 1;

-- Backfill: If employee has multiple stations, use the first one as mainStation
UPDATE "Employee"
SET "mainStation" = "assignedStations"[1]
WHERE array_length("assignedStations", 1) > 1
  AND "mainStation" IS NULL;
