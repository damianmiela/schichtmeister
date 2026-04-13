-- Add currentVersionId to track which version the schedule currently reflects
ALTER TABLE "Schedule" ADD COLUMN "currentVersionId" TEXT;
