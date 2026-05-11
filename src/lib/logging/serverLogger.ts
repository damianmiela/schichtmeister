import fs from "fs";
import path from "path";
import type { LogEntry, LogType, LogQuery, LogQueryResult } from "./logTypes";

/* ──────────────── Configuration ──────────────── */

const LOG_DIR = path.resolve(process.cwd(), "logs");

/** Rolling retention window — files older than this are deleted. */
const RETENTION_DAYS = 30;
/** Don't hit the filesystem on every write — gate the pruner to ~hourly. */
const PRUNE_THROTTLE_MS = 60 * 60 * 1000;
let lastPruneAt = 0;

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function logFilePath(type: LogType, date: string): string {
  return path.join(LOG_DIR, `${type}-${date}.jsonl`);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Delete log files whose date portion is older than RETENTION_DAYS.
 * Throttled to once per PRUNE_THROTTLE_MS so we don't stat the directory
 * on every single write. Silent on any error — logging must never throw.
 */
function pruneOldLogs(): void {
  const nowMs = Date.now();
  if (nowMs - lastPruneAt < PRUNE_THROTTLE_MS) return;
  lastPruneAt = nowMs;
  try {
    if (!fs.existsSync(LOG_DIR)) return;
    const cutoff = new Date(nowMs - RETENTION_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const files = fs.readdirSync(LOG_DIR);
    const fileRe = /^(activity|system)-(\d{4}-\d{2}-\d{2})\.jsonl$/;
    for (const f of files) {
      const m = fileRe.exec(f);
      if (!m) continue;
      const date = m[2]!;
      if (date < cutoff) {
        try {
          fs.unlinkSync(path.join(LOG_DIR, f));
        } catch {
          /* skip individual file errors */
        }
      }
    }
  } catch {
    /* logging must never throw */
  }
}

/* ──────────────── Write ──────────────── */

/**
 * Append a single log entry to the appropriate .jsonl file.
 * Non-blocking — fire and forget. Errors are silently caught
 * so logging never crashes the app.
 */
export function writeLog(type: LogType, entry: LogEntry): void {
  try {
    ensureLogDir();
    const date = entry.ts.slice(0, 10) || todayIso();
    const filePath = logFilePath(type, date);
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(filePath, line, "utf-8");
    pruneOldLogs();
  } catch {
    // Logging must never throw
  }
}

/**
 * Append a batch of log entries. Used by the activity-log API.
 */
export function writeBatch(type: LogType, entries: LogEntry[]): void {
  if (entries.length === 0) return;
  try {
    ensureLogDir();
    // Group by date for efficiency
    const byDate = new Map<string, string[]>();
    for (const entry of entries) {
      const date = entry.ts.slice(0, 10) || todayIso();
      const arr = byDate.get(date) ?? [];
      arr.push(JSON.stringify(entry));
      byDate.set(date, arr);
    }
    for (const [date, lines] of byDate) {
      const filePath = logFilePath(type, date);
      fs.appendFileSync(filePath, lines.join("\n") + "\n", "utf-8");
    }
    pruneOldLogs();
  } catch {
    // Logging must never throw
  }
}

/* ──────────────── Read ──────────────── */

/**
 * Read log entries matching the given query.
 * Scans .jsonl files for the date range and applies filters.
 */
export function readLogs(query: LogQuery): LogQueryResult {
  const {
    type,
    startDate,
    endDate,
    userId,
    eventTypes,
    limit = 200,
    offset = 0,
  } = query;

  ensureLogDir();

  // Collect all relevant files
  const files = getLogFiles(type, startDate, endDate);

  // Read and parse all entries (newest first)
  let allEntries: LogEntry[] = [];
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as LogEntry;
          // Apply filters
          if (userId && entry.userId !== userId) continue;
          if (eventTypes && eventTypes.length > 0 && !eventTypes.includes(entry.type)) continue;
          allEntries.push(entry);
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Sort by timestamp descending (newest first)
  allEntries.sort((a, b) => b.ts.localeCompare(a.ts));

  const total = allEntries.length;
  const sliced = allEntries.slice(offset, offset + limit);

  return {
    entries: sliced,
    total,
    hasMore: offset + limit < total,
  };
}

/**
 * Get distinct user IDs and names from log files.
 */
export function getLogUsers(
  type: LogType,
  startDate?: string,
  endDate?: string,
): { userId: string; userName: string; eventCount: number; lastSeen: string }[] {
  ensureLogDir();
  const files = getLogFiles(type, startDate, endDate);
  const users = new Map<string, { userName: string; count: number; lastSeen: string }>();

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as LogEntry;
          if (!entry.userId) continue;
          const existing = users.get(entry.userId);
          if (existing) {
            existing.count++;
            if (entry.ts > existing.lastSeen) {
              existing.lastSeen = entry.ts;
              if (entry.userName) existing.userName = entry.userName;
            }
          } else {
            users.set(entry.userId, {
              userName: entry.userName || "Unbekannt",
              count: 1,
              lastSeen: entry.ts,
            });
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return Array.from(users.entries())
    .map(([userId, data]) => ({
      userId,
      userName: data.userName,
      eventCount: data.count,
      lastSeen: data.lastSeen,
    }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

/**
 * Get summary stats for the admin dashboard.
 */
export function getLogStats(type: LogType, date?: string): {
  totalEvents: number;
  uniqueUsers: number;
  fileSize: string;
  availableDates: string[];
} {
  ensureLogDir();
  const targetDate = date || todayIso();
  const filePath = logFilePath(type, targetDate);

  let totalEvents = 0;
  const userSet = new Set<string>();
  let fileSize = "0 KB";

  try {
    const stat = fs.statSync(filePath);
    fileSize = stat.size < 1024
      ? `${stat.size} B`
      : stat.size < 1048576
        ? `${(stat.size / 1024).toFixed(1)} KB`
        : `${(stat.size / 1048576).toFixed(1)} MB`;

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    totalEvents = lines.length;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LogEntry;
        if (entry.userId) userSet.add(entry.userId);
      } catch { /* skip */ }
    }
  } catch { /* file doesn't exist */ }

  // List all available dates for this type
  const availableDates: string[] = [];
  try {
    const allFiles = fs.readdirSync(LOG_DIR);
    const prefix = `${type}-`;
    for (const f of allFiles) {
      if (f.startsWith(prefix) && f.endsWith(".jsonl")) {
        const dateStr = f.slice(prefix.length, -6);
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          availableDates.push(dateStr);
        }
      }
    }
    availableDates.sort((a, b) => b.localeCompare(a));
  } catch { /* skip */ }

  return { totalEvents, uniqueUsers: userSet.size, fileSize, availableDates };
}

/* ──────────────── Helpers ──────────────── */

function getLogFiles(type: LogType, startDate?: string, endDate?: string): string[] {
  try {
    const allFiles = fs.readdirSync(LOG_DIR);
    const prefix = `${type}-`;
    const relevant = allFiles
      .filter((f) => f.startsWith(prefix) && f.endsWith(".jsonl"))
      .filter((f) => {
        const dateStr = f.slice(prefix.length, -6);
        if (startDate && dateStr < startDate) return false;
        if (endDate && dateStr > endDate) return false;
        return true;
      })
      .sort((a, b) => b.localeCompare(a)) // newest first
      .map((f) => path.join(LOG_DIR, f));
    return relevant;
  } catch {
    return [];
  }
}
