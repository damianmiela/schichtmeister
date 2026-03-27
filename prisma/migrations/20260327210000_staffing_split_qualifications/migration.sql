-- Phase 14: Split staffing requirements into headcount + qualification requirements.
-- 1. Add ruleOverridesJson to Facility
ALTER TABLE "Facility" ADD COLUMN "ruleOverridesJson" TEXT;

-- 2. Rename minStaffCount -> minTotalCount
ALTER TABLE "StaffingRequirement" RENAME COLUMN "minStaffCount" TO "minTotalCount";

-- 3. Create QualificationRequirement table
CREATE TABLE "QualificationRequirement" (
    "id" TEXT NOT NULL,
    "staffingRequirementId" TEXT NOT NULL,
    "qualificationTag" TEXT NOT NULL,
    "minCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualificationRequirement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QualificationRequirement_staffingRequirementId_qualificationTag_key"
  ON "QualificationRequirement"("staffingRequirementId", "qualificationTag");

ALTER TABLE "QualificationRequirement"
  ADD CONSTRAINT "QualificationRequirement_staffingRequirementId_fkey"
  FOREIGN KEY ("staffingRequirementId") REFERENCES "StaffingRequirement"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Migrate existing requiredQualificationTags into QualificationRequirement rows
INSERT INTO "QualificationRequirement" ("id", "staffingRequirementId", "qualificationTag", "minCount", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  sr."id",
  unnest(sr."requiredQualificationTags"),
  1,
  NOW(),
  NOW()
FROM "StaffingRequirement" sr
WHERE array_length(sr."requiredQualificationTags", 1) > 0;

-- 5. Drop the old array column
ALTER TABLE "StaffingRequirement" DROP COLUMN "requiredQualificationTags";
