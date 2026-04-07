-- Add name and lastActiveAt columns to User
ALTER TABLE "User" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- Remove EMPLOYEE enum value (rename to DEMO will happen in next migration)
