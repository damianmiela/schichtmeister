-- Add warningsJson column to Schedule for persisting generation warnings
ALTER TABLE "Schedule" ADD COLUMN "warningsJson" TEXT;
