/**
 * In-process cache of completed-race results, keyed by scheduleId. Used by
 * the `generate-stream` route to support race-level RESUME after a network
 * glitch: when a multi-Race-Lauf generation gets interrupted mid-flight (e.g.
 * the client's SSE connection drops at race 5 of 10), the races that already
 * finished are kept in this cache for 30 minutes. The retry POST sets
 * `resume: true`, and the route skips any variant that's still in the cache,
 * re-running only the ones that didn't complete.
 *
 * SCOPE / LIMITATIONS:
 *  - Process-local memory only. Lost if the Node process restarts.
 *  - Single-replica only. Multi-replica deployments need Redis or DB.
 *  - 30-min TTL per entry; periodic 5-min GC sweep removes stale ones.
 *  - This is the "Plan A" of the cancellation/resume story — pragmatic, small.
 *    A "Plan B" (full job state in Prisma) is the long-term direction once
 *    multi-instance scale or restart-survival becomes a real need.
 */

export type CachedRaceResult = {
  variant: string;            // "A".."J" or "Einzellauf"
  label: string;              // user-visible label, e.g. "Rennen A"
  result: Record<string, unknown>; // full solver response
  randomSeed?: number;
  numWorkers: number;
};

type CachedGeneration = {
  scheduleId: string;
  variants: Map<string, CachedRaceResult>; // keyed by variant label
  /** Wall-clock millis when the cache entry was last touched. Drives TTL. */
  lastUpdatedAt: number;
};

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const GC_INTERVAL_MS = 5 * 60 * 1000; // sweep every 5 minutes

const _cache = new Map<string, CachedGeneration>();

/**
 * Return all cached race results for this schedule (empty array if none).
 * The caller decides which variants to skip based on this list. Stale entries
 * (last update > TTL ago) are evicted lazily on access.
 */
export function getCachedRaces(scheduleId: string): CachedRaceResult[] {
  const entry = _cache.get(scheduleId);
  if (!entry) return [];
  if (Date.now() - entry.lastUpdatedAt > TTL_MS) {
    _cache.delete(scheduleId);
    return [];
  }
  return [...entry.variants.values()];
}

/**
 * Save a completed race result. Creates the schedule entry lazily on first
 * call. Replacing an existing variant overwrites it (caller policy decides
 * whether to overwrite — currently the route only calls this for variants
 * NOT already in cache, so collisions shouldn't happen in practice).
 */
export function recordRaceResult(
  scheduleId: string,
  race: CachedRaceResult,
): void {
  let entry = _cache.get(scheduleId);
  if (!entry) {
    entry = {
      scheduleId,
      variants: new Map(),
      lastUpdatedAt: Date.now(),
    };
    _cache.set(scheduleId, entry);
  }
  entry.variants.set(race.variant, race);
  entry.lastUpdatedAt = Date.now();
}

/**
 * Drop the cache entry for this schedule. Called at the end of a successful
 * generation (we don't need the cache anymore) and also on explicit cancel
 * (so a fresh attempt doesn't accidentally pick up stale results).
 */
export function clearCache(scheduleId: string): void {
  _cache.delete(scheduleId);
}

/**
 * Periodic GC: drops entries older than TTL_MS. Idempotent and safe to run
 * even when the cache is empty.
 */
function _gcSweep(): void {
  const now = Date.now();
  for (const [id, entry] of _cache.entries()) {
    if (now - entry.lastUpdatedAt > TTL_MS) {
      _cache.delete(id);
    }
  }
}

// Kick off the GC interval. unref() so this doesn't keep the Node process
// alive during shutdown (test runs etc.).
const _gcTimer = setInterval(_gcSweep, GC_INTERVAL_MS);
if (typeof _gcTimer === "object" && _gcTimer && "unref" in _gcTimer) {
  (_gcTimer as { unref: () => void }).unref();
}
