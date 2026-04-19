-- Add warningCount to ScheduleVersion so different versions can be compared
-- by their number of validation warnings. Nullable so existing rows keep
-- their current meaning ("unknown") — only new snapshots will store it.
ALTER TABLE "ScheduleVersion" ADD COLUMN "warningCount" INTEGER;
