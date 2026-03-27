-- Add stationNumber to ShiftProfile (default 1)
ALTER TABLE "ShiftProfile" ADD COLUMN "stationNumber" INTEGER NOT NULL DEFAULT 1;

-- Attempt to parse existing profile names to set correct station numbers.
-- Patterns: F1→station1, F2→station2, F3→station3, S1→station1, etc.
UPDATE "ShiftProfile"
SET "stationNumber" = CASE
    WHEN "name" ~ '^[FSN][1-3]$' THEN CAST(SUBSTRING("name" FROM 2 FOR 1) AS INTEGER)
    ELSE 1
END;

-- Drop old unique index on (facilityId, name) and create new one on (facilityId, shiftType, stationNumber)
DROP INDEX IF EXISTS "ShiftProfile_facilityId_name_key";
CREATE UNIQUE INDEX "ShiftProfile_facilityId_shiftType_stationNumber_key"
    ON "ShiftProfile" ("facilityId", "shiftType", "stationNumber");

-- Add stationNumber to StaffingRequirement (default 1)
ALTER TABLE "StaffingRequirement" ADD COLUMN "stationNumber" INTEGER NOT NULL DEFAULT 1;

-- Drop old unique index and create new one
DROP INDEX IF EXISTS "StaffingRequirement_facilityId_shiftType_key";
CREATE UNIQUE INDEX "StaffingRequirement_facilityId_shiftType_stationNumber_key"
    ON "StaffingRequirement" ("facilityId", "shiftType", "stationNumber");
