-- Add virtualPlacementsJson to Schedule. This stores a per-schedule map of
-- employeeId -> "1" | "2" | "3" | "NIGHT", so an employee without a permanent
-- mainStation can be placed into a station or night table just for this plan.
-- Nullable so existing rows are unaffected.
ALTER TABLE "Schedule" ADD COLUMN "virtualPlacementsJson" TEXT;
