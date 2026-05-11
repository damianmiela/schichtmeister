"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import type { ActivityEvent } from "@/lib/logging/logTypes";

/* ──────────────── Config ──────────────── */

const FLUSH_INTERVAL_MS = 15_000;   // Send batch every 15 seconds
const MAX_BATCH_SIZE = 100;         // Force flush if batch gets large
const API_URL = "/api/activity-log";

/* ──────────────── Helpers ──────────────── */

function generateSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

/* ──────────────── Hook ──────────────── */

/**
 * Activity tracker — *intentionally minimal*. We only emit `page_view`
 * events so the admin log gives a "where is this user right now / which
 * pages did they visit" view of activity. Meaningful actions (generation
 * runs, logins, API errors) are already logged server-side, so adding
 * every click / focus / blur / scroll / form change here would just drown
 * the timeline.
 *
 * If you want to track an additional explicit user action (e.g. "user
 * clicked Veröffentlichen"), prefer doing it on the API route that
 * performs the work — that way the log captures intent + outcome together.
 */
export function useActivityTracker() {
  const pathname = usePathname();
  const bufferRef = useRef<ActivityEvent[]>([]);
  const sessionIdRef = useRef<string>("");
  const prevPathRef = useRef<string>("");
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Flush buffer to server ──
  const flush = useCallback(() => {
    const events = bufferRef.current;
    if (events.length === 0) return;
    bufferRef.current = [];

    const payload = JSON.stringify({ events });

    // sendBeacon is reliable on page unload.
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const sent = navigator.sendBeacon(
        API_URL,
        new Blob([payload], { type: "application/json" }),
      );
      if (sent) return;
    }

    // Fallback to fetch (fire-and-forget).
    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Silently drop — logging must never break the app.
    });
  }, []);

  // ── Push event to buffer ──
  const push = useCallback(
    (event: Omit<ActivityEvent, "sessionId">) => {
      bufferRef.current.push({
        ...event,
        sessionId: sessionIdRef.current,
      } as ActivityEvent);
      if (bufferRef.current.length >= MAX_BATCH_SIZE) {
        flush();
      }
    },
    [flush],
  );

  // ── Session id + periodic flush timer ──
  useEffect(() => {
    sessionIdRef.current = generateSessionId();
    flushTimerRef.current = setInterval(flush, FLUSH_INTERVAL_MS);
    return () => {
      flush();
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
    };
  }, [flush]);

  // ── Page view tracking ──
  // The only event we emit. Consecutive page_views per session give a
  // step-by-step path through the app and timestamps imply per-page duration.
  useEffect(() => {
    if (!pathname) return;
    if (prevPathRef.current === pathname) return; // ignore re-renders
    prevPathRef.current = pathname;

    push({
      ts: now(),
      type: "page_view",
      data: {
        path: pathname,
        title: typeof document !== "undefined" ? document.title : undefined,
      },
    });
  }, [pathname, push]);

  // ── Final flush on unload ──
  useEffect(() => {
    const handleUnload = () => flush();
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [flush]);
}
