"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import type { ActivityEvent } from "@/lib/logging/logTypes";

/* ──────────────── Config ──────────────── */

const FLUSH_INTERVAL_MS = 15_000;   // Send batch every 15 seconds
const MAX_BATCH_SIZE = 100;         // Force flush if batch gets large
const TEXT_TRUNCATE = 60;           // Max chars for click text
const API_URL = "/api/activity-log";

/* ──────────────── Helpers ──────────────── */

function generateSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

function getScrollDepthPct(): number {
  const doc = document.documentElement;
  const scrollTop = window.scrollY || doc.scrollTop;
  const scrollHeight = doc.scrollHeight - doc.clientHeight;
  if (scrollHeight <= 0) return 100;
  return Math.round((scrollTop / scrollHeight) * 100);
}

function getCssSelector(el: HTMLElement): string {
  const parts: string[] = [];
  let current: HTMLElement | null = el;
  let depth = 0;
  while (current && depth < 5) {
    let sel = current.tagName.toLowerCase();
    if (current.id) {
      sel += `#${current.id}`;
      parts.unshift(sel);
      break;
    }
    if (current.className && typeof current.className === "string") {
      const cls = current.className.trim().split(/\s+/).slice(0, 2).join(".");
      if (cls) sel += `.${cls}`;
    }
    parts.unshift(sel);
    current = current.parentElement;
    depth++;
  }
  return parts.join(" > ");
}

function getClickText(el: HTMLElement): string {
  const text =
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    el.innerText ||
    el.getAttribute("alt") ||
    "";
  return text.trim().slice(0, TEXT_TRUNCATE);
}

/* ──────────────── Hook ──────────────── */

export function useActivityTracker() {
  const pathname = usePathname();
  const bufferRef = useRef<ActivityEvent[]>([]);
  const sessionIdRef = useRef<string>("");
  const pageEnterRef = useRef<number>(Date.now());
  const prevPathRef = useRef<string>("");
  const maxScrollRef = useRef<number>(0);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Push event to buffer ──
  const push = useCallback((event: Omit<ActivityEvent, "sessionId">) => {
    bufferRef.current.push({
      ...event,
      sessionId: sessionIdRef.current,
    } as ActivityEvent);
    if (bufferRef.current.length >= MAX_BATCH_SIZE) {
      flush();
    }
  }, []);

  // ── Flush buffer to server ──
  const flush = useCallback(() => {
    const events = bufferRef.current;
    if (events.length === 0) return;
    bufferRef.current = [];

    const payload = JSON.stringify({ events });

    // Use sendBeacon for reliability (works on page unload)
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const sent = navigator.sendBeacon(
        API_URL,
        new Blob([payload], { type: "application/json" }),
      );
      if (sent) return;
    }

    // Fallback to fetch (fire-and-forget)
    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Silently drop — logging should never break the app
    });
  }, []);

  // ── Session start ──
  useEffect(() => {
    sessionIdRef.current = generateSessionId();

    push({
      ts: now(),
      type: "session_start",
      data: {
        userAgent: navigator.userAgent,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        language: navigator.language,
      },
    });

    // Flush timer
    flushTimerRef.current = setInterval(flush, FLUSH_INTERVAL_MS);

    // Cleanup on unmount
    return () => {
      push({
        ts: now(),
        type: "session_end",
        data: { durationMs: Date.now() - pageEnterRef.current },
      });
      flush();
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Page view tracking ──
  useEffect(() => {
    if (!pathname) return;

    // Log leave for previous page
    if (prevPathRef.current && prevPathRef.current !== pathname) {
      push({
        ts: now(),
        type: "page_leave",
        data: {
          path: prevPathRef.current,
          durationMs: Date.now() - pageEnterRef.current,
          scrollDepthPct: maxScrollRef.current,
        },
      });
    }

    // Log view for new page
    pageEnterRef.current = Date.now();
    maxScrollRef.current = 0;
    prevPathRef.current = pathname;

    push({
      ts: now(),
      type: "page_view",
      data: {
        path: pathname,
        referrer: typeof document !== "undefined" ? document.referrer : undefined,
        title: typeof document !== "undefined" ? document.title : undefined,
      },
    });
  }, [pathname, push]);

  // ── Click tracking ──
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target?.tagName) return;

      push({
        ts: now(),
        type: "click",
        data: {
          element: target.tagName.toLowerCase(),
          text: getClickText(target),
          selector: getCssSelector(target),
          path: window.location.pathname,
          x: Math.round(e.clientX),
          y: Math.round(e.clientY),
        },
      });
    };

    document.addEventListener("click", handleClick, { passive: true, capture: true });
    return () => document.removeEventListener("click", handleClick, true);
  }, [push]);

  // ── Scroll depth tracking ──
  useEffect(() => {
    const handleScroll = () => {
      const depth = getScrollDepthPct();
      if (depth > maxScrollRef.current) {
        maxScrollRef.current = depth;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // ── Focus/blur tracking ──
  useEffect(() => {
    const handleFocus = () => {
      push({ ts: now(), type: "focus", data: { path: window.location.pathname } });
    };
    const handleBlur = () => {
      push({ ts: now(), type: "blur", data: { path: window.location.pathname } });
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, [push]);

  // ── Beforeunload — final flush ──
  useEffect(() => {
    const handleUnload = () => {
      // Record page leave
      if (prevPathRef.current) {
        bufferRef.current.push({
          ts: now(),
          type: "page_leave",
          sessionId: sessionIdRef.current,
          data: {
            path: prevPathRef.current,
            durationMs: Date.now() - pageEnterRef.current,
            scrollDepthPct: maxScrollRef.current,
          },
        });
      }
      flush();
    };

    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [flush]);
}
