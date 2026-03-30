-- Convert assignedStationNumber (nullable Int) to assignedStations (Int array)
ALTER TABLE "Employee" ADD COLUMN "assignedStations" INTEGER[] NOT NULL DEFAULT '{}';

-- Migrate existing data: if assignedStationNumber was set, put it into the array
UPDATE "Employee"
SET "assignedStations" = ARRAY["assignedStationNumber"]
WHERE "assignedStationNumber" IS NOT NULL;

-- Drop the old column
ALTER TABLE "Employee" DROP COLUMN "assignedStationNumber";
