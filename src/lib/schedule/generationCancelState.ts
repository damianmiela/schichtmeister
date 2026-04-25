/**
 * In-process registry of currently-running schedule generations, keyed by
 * scheduleId. The /api/schedules/[id]/cancel-generation endpoint looks up
 * the entry for a schedule, forwards a cancel signal to the Python solver
 * via that solver's /cancel/{cancelKey} endpoint, and flips a local flag
 * so the generate-stream race loop also skips remaining races.
 *
 * NOTE on multi-replica deployments: this is process-local state. If the
 * frontend ever runs on multiple replicas behind a load balancer with
 * sticky sessions disabled, the cancel POST might land on a different
 * replica than the one running the generation, and the cancel won't
 * reach the running solver. For single-replica deployments this is fine.
 * Move to Redis (or similar) if/when scaling out.
 */

type RunningGeneration = {
  cancelKey: string;
  /** Mutable holder so the generate-stream race loop can check it
   * BEFORE starting the next race and bail out if cancelled. */
  cancelled: { value: boolean };
};

const _running = new Map<string, RunningGeneration>();

export function registerGeneration(
  scheduleId: string,
  cancelKey: string,
): RunningGeneration {
  const entry: RunningGeneration = {
    cancelKey,
    cancelled: { value: false },
  };
  _running.set(scheduleId, entry);
  return entry;
}

export function unregisterGeneration(scheduleId: string): void {
  _running.delete(scheduleId);
}

/** Return the running entry for this schedule, or null if no active
 * generation. */
export function getRunningGeneration(
  scheduleId: string,
): RunningGeneration | null {
  return _running.get(scheduleId) ?? null;
}

/** Mark the running generation for a schedule as cancelled. Returns the
 * cancelKey (so the caller can forward the signal to the Python solver),
 * or null if there's no active generation. Idempotent. */
export function markGenerationCancelled(
  scheduleId: string,
): string | null {
  const entry = _running.get(scheduleId);
  if (!entry) return null;
  entry.cancelled.value = true;
  return entry.cancelKey;
}
