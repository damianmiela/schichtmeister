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
 *
 * Several runs can be active for one schedule (two people generating the same
 * month). Each run removes only its own entry when it ends, and a cancel stops
 * every run of that schedule.
 */

type RunningGeneration = {
  cancelKey: string;
  /** Mutable holder so the generate-stream race loop can check it
   * BEFORE starting the next race and bail out if cancelled. */
  cancelled: { value: boolean };
};

const _running = new Map<string, Set<RunningGeneration>>();

export function registerGeneration(
  scheduleId: string,
  cancelKey: string,
): RunningGeneration {
  const entry: RunningGeneration = {
    cancelKey,
    cancelled: { value: false },
  };
  const runs = _running.get(scheduleId) ?? new Set<RunningGeneration>();
  runs.add(entry);
  _running.set(scheduleId, runs);
  return entry;
}

/** Remove this run's entry; other runs of the same schedule stay cancellable. */
export function unregisterGeneration(
  scheduleId: string,
  entry: RunningGeneration,
): void {
  const runs = _running.get(scheduleId);
  if (!runs) return;
  runs.delete(entry);
  if (runs.size === 0) _running.delete(scheduleId);
}

/** Mark every running generation of a schedule as cancelled. Returns their
 * cancelKeys (so the caller can forward the signal to the Python solver),
 * empty when nothing is running. Idempotent. */
export function markGenerationCancelled(scheduleId: string): string[] {
  const runs = [...(_running.get(scheduleId) ?? [])];
  for (const run of runs) run.cancelled.value = true;
  return runs.map((run) => run.cancelKey);
}
