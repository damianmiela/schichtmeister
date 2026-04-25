-- Add per-facility solver weight overrides. JSON map of W_* keys to integer
-- values. NULL = use solver factory defaults from solver/config.py. Validated
-- by validateWeights() in src/lib/solver/weights.ts before save (frontend
-- and admin API both run validation server-side).
ALTER TABLE "Facility" ADD COLUMN "solverWeightsJson" TEXT;
