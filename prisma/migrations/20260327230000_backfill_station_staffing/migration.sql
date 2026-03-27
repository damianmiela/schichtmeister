-- Backfill: for each existing StaffingRequirement at station 1, create copies
-- for stations 2 and 3 (if they don't already exist).
-- This ensures that facilities which had 3 staffing rows (one per shift type)
-- now have 9 rows (one per shift type × station).

INSERT INTO "StaffingRequirement" ("id", "facilityId", "shiftType", "stationNumber", "minTotalCount", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    sr."facilityId",
    sr."shiftType",
    s.n,
    sr."minTotalCount",
    NOW(),
    NOW()
FROM "StaffingRequirement" sr
CROSS JOIN (VALUES (2), (3)) AS s(n)
WHERE sr."stationNumber" = 1
  AND NOT EXISTS (
    SELECT 1 FROM "StaffingRequirement" sr2
    WHERE sr2."facilityId" = sr."facilityId"
      AND sr2."shiftType" = sr."shiftType"
      AND sr2."stationNumber" = s.n
  );

-- Also copy qualification requirements from station-1 rows to the new station 2/3 rows
INSERT INTO "QualificationRequirement" ("id", "staffingRequirementId", "qualificationTag", "minCount", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    sr_new.id,
    qr."qualificationTag",
    qr."minCount",
    NOW(),
    NOW()
FROM "QualificationRequirement" qr
JOIN "StaffingRequirement" sr_old ON qr."staffingRequirementId" = sr_old.id AND sr_old."stationNumber" = 1
JOIN "StaffingRequirement" sr_new ON sr_new."facilityId" = sr_old."facilityId"
                                  AND sr_new."shiftType" = sr_old."shiftType"
                                  AND sr_new."stationNumber" IN (2, 3)
WHERE NOT EXISTS (
    SELECT 1 FROM "QualificationRequirement" qr2
    WHERE qr2."staffingRequirementId" = sr_new.id
      AND qr2."qualificationTag" = qr."qualificationTag"
);
