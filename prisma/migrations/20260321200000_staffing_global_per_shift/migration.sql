-- Global staffing: one row per facility + shift type (same minimum every calendar day).
-- Consolidate existing per-weekday rows: take MAX(minStaffCount), keep one row per (facilityId, shiftType).

UPDATE "StaffingRequirement" AS s
SET "minStaffCount" = sub.mx
FROM (
  SELECT "facilityId", "shiftType", MAX("minStaffCount") AS mx
  FROM "StaffingRequirement"
  GROUP BY "facilityId", "shiftType"
) AS sub
WHERE s."facilityId" = sub."facilityId" AND s."shiftType" = sub."shiftType";

DELETE FROM "StaffingRequirement" AS a
WHERE EXISTS (
  SELECT 1
  FROM "StaffingRequirement" AS b
  WHERE b."facilityId" = a."facilityId"
    AND b."shiftType" = a."shiftType"
    AND b.id < a.id
);

DROP INDEX IF EXISTS "StaffingRequirement_facilityId_dayOfWeek_shiftType_idx";

ALTER TABLE "StaffingRequirement" DROP COLUMN "dayOfWeek";

CREATE UNIQUE INDEX "StaffingRequirement_facilityId_shiftType_key" ON "StaffingRequirement"("facilityId", "shiftType");
