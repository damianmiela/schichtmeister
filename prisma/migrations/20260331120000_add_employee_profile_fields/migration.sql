-- AlterEnum
ALTER TYPE "EmployeeStatus" ADD VALUE 'INACTIVE';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "isFullTimeBl" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Employee" ADD COLUMN "fixedWorkingDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "Employee" ADD COLUMN "shiftDistribution" JSONB;
