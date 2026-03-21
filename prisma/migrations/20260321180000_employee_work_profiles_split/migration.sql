-- Reusable "employee work" templates (Soll %, contract) — separate from shift timing profiles
CREATE TABLE "EmployeeWorkProfile" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetHoursPercent" DECIMAL(6,2) NOT NULL,
    "contractType" "ContractType" NOT NULL,
    "miniJobMaxMonthlyHours" DECIMAL(8,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeWorkProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeWorkProfile_facilityId_name_key" ON "EmployeeWorkProfile"("facilityId", "name");
CREATE INDEX "EmployeeWorkProfile_facilityId_idx" ON "EmployeeWorkProfile"("facilityId");

ALTER TABLE "EmployeeWorkProfile" ADD CONSTRAINT "EmployeeWorkProfile_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Employee: store Soll % explicitly; optional link to a saved template
ALTER TABLE "Employee" ADD COLUMN "targetHoursPercent" DECIMAL(6,2);
ALTER TABLE "Employee" ADD COLUMN "workProfileId" TEXT;

-- Backfill from linked shift profile (old model) before we drop that FK
UPDATE "Employee" e
SET
  "targetHoursPercent" = CASE
    WHEN sp."contractType" = 'MINI_JOB' THEN NULL
    ELSE sp."targetHoursPercent"
  END,
  "contractType" = sp."contractType",
  "miniJobMaxMonthlyHours" = CASE
    WHEN sp."contractType" = 'MINI_JOB' THEN COALESCE(sp."miniJobMaxMonthlyHours", e."miniJobMaxMonthlyHours")
    ELSE e."miniJobMaxMonthlyHours"
  END
FROM "ShiftProfile" sp
WHERE e."shiftProfileId" = sp."id";

-- Derive percent from legacy weekly hours where still missing
UPDATE "Employee"
SET "targetHoursPercent" = ROUND(("targetHours" / 40.0) * 100, 2)
WHERE "targetHoursPercent" IS NULL
  AND "targetHours" IS NOT NULL
  AND "targetHoursPeriod" = 'WEEKLY';

-- Recompute weekly target hours from percent (non–mini-job)
UPDATE "Employee"
SET
  "targetHours" = ROUND(("targetHoursPercent" / 100.0) * 40, 2),
  "targetHoursPeriod" = 'WEEKLY'
WHERE "targetHoursPercent" IS NOT NULL
  AND "contractType" IN ('FULL_TIME', 'PART_TIME');

UPDATE "Employee"
SET "targetHours" = NULL, "targetHoursPeriod" = NULL
WHERE "contractType" = 'MINI_JOB';

-- Drop employee → shift profile
ALTER TABLE "Employee" DROP CONSTRAINT IF EXISTS "Employee_shiftProfileId_fkey";
DROP INDEX IF EXISTS "Employee_shiftProfileId_idx";
ALTER TABLE "Employee" DROP COLUMN "shiftProfileId";

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_workProfileId_fkey" FOREIGN KEY ("workProfileId") REFERENCES "EmployeeWorkProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Employee_workProfileId_idx" ON "Employee"("workProfileId");

-- Shift profiles: timing only
ALTER TABLE "ShiftProfile" DROP COLUMN IF EXISTS "targetHoursPercent";
ALTER TABLE "ShiftProfile" DROP COLUMN IF EXISTS "contractType";
ALTER TABLE "ShiftProfile" DROP COLUMN IF EXISTS "miniJobMaxMonthlyHours";
