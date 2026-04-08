-- Remove ghost per-station NIGHT staffing requirements.
-- NIGHT shifts are facility-wide (stationNumber=0, isFacilityWide=true).
-- Per-station NIGHT rows (isFacilityWide=false) are leftover artifacts
-- that cause false "Unterbesetzung Nachtdienst" validation warnings.
DELETE FROM "StaffingRequirement"
WHERE "shiftType" = 'NIGHT'
  AND "isFacilityWide" = false;
