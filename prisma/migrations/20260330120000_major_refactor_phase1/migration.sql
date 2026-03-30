-- Phase 1: Major Refactor — Data Model Foundation

-- 1. New enums
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'KRANK', 'LANGZEITKRANK', 'MUTTERSCHUTZ', 'URLAUB', 'KUR');
CREATE TYPE "AbsenceType" AS ENUM ('KRANK', 'URLAUB');

-- 2. Add BL to ShiftType enum
ALTER TYPE "ShiftType" ADD VALUE 'BL';

-- 3. Create Qualification table
CREATE TABLE "Qualification" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Qualification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Qualification_facilityId_name_key" ON "Qualification"("facilityId", "name");
CREATE UNIQUE INDEX "Qualification_facilityId_abbreviation_key" ON "Qualification"("facilityId", "abbreviation");
ALTER TABLE "Qualification" ADD CONSTRAINT "Qualification_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Create implicit M:N join table for Employee <-> Qualification
CREATE TABLE "_EmployeeQualifications" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_EmployeeQualifications_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_EmployeeQualifications_B_index" ON "_EmployeeQualifications"("B");
ALTER TABLE "_EmployeeQualifications" ADD CONSTRAINT "_EmployeeQualifications_A_fkey" FOREIGN KEY ("A") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_EmployeeQualifications" ADD CONSTRAINT "_EmployeeQualifications_B_fkey" FOREIGN KEY ("B") REFERENCES "Qualification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Create implicit M:N join table for Employee <-> ShiftProfile (allowed profiles)
CREATE TABLE "_EmployeeAllowedShiftProfiles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_EmployeeAllowedShiftProfiles_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_EmployeeAllowedShiftProfiles_B_index" ON "_EmployeeAllowedShiftProfiles"("B");
ALTER TABLE "_EmployeeAllowedShiftProfiles" ADD CONSTRAINT "_EmployeeAllowedShiftProfiles_A_fkey" FOREIGN KEY ("A") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_EmployeeAllowedShiftProfiles" ADD CONSTRAINT "_EmployeeAllowedShiftProfiles_B_fkey" FOREIGN KEY ("B") REFERENCES "ShiftProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Create EmployeeAbsence table
CREATE TABLE "EmployeeAbsence" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "AbsenceType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAbsence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeAbsence_employeeId_startDate_endDate_idx" ON "EmployeeAbsence"("employeeId", "startDate", "endDate");
ALTER TABLE "EmployeeAbsence" ADD CONSTRAINT "EmployeeAbsence_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Add status column to Employee
ALTER TABLE "Employee" ADD COLUMN "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE';

-- 8. ShiftProfile: add split-shift columns
ALTER TABLE "ShiftProfile" ADD COLUMN "startTime2" TEXT;
ALTER TABLE "ShiftProfile" ADD COLUMN "endTime2" TEXT;
ALTER TABLE "ShiftProfile" ADD COLUMN "breakMinutes2" INTEGER;

-- 9. ShiftProfile: drop old unique constraint, drop stationNumber, add new unique
DROP INDEX "ShiftProfile_facilityId_shiftType_stationNumber_key";
ALTER TABLE "ShiftProfile" DROP COLUMN "stationNumber";
CREATE UNIQUE INDEX "ShiftProfile_facilityId_name_key" ON "ShiftProfile"("facilityId", "name");

-- 10. StaffingRequirement: add maxTotalCount and isFacilityWide, update unique constraint
ALTER TABLE "StaffingRequirement" ADD COLUMN "maxTotalCount" INTEGER;
ALTER TABLE "StaffingRequirement" ADD COLUMN "isFacilityWide" BOOLEAN NOT NULL DEFAULT false;
DROP INDEX "StaffingRequirement_facilityId_shiftType_stationNumber_key";
CREATE UNIQUE INDEX "StaffingRequirement_facilityId_shiftType_stationNumber_isFac_key" ON "StaffingRequirement"("facilityId", "shiftType", "stationNumber", "isFacilityWide");

-- 11. Assignment: add new columns
ALTER TABLE "Assignment" ADD COLUMN "stationNumber" INTEGER;
ALTER TABLE "Assignment" ADD COLUMN "markingRow2" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "markingRow3" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "dayStatus" TEXT;
