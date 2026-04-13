-- Add contentHash column for deduplication
ALTER TABLE "ScheduleVersion" ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '';

-- Backfill: compute hash placeholder for existing rows (will be unique per row)
UPDATE "ScheduleVersion" SET "contentHash" = "id" WHERE "contentHash" = '';

-- Remove the default so future inserts must provide a real hash
ALTER TABLE "ScheduleVersion" ALTER COLUMN "contentHash" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "ScheduleVersion_scheduleId_contentHash_idx" ON "ScheduleVersion"("scheduleId", "contentHash");
