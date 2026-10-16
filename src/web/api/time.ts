// Durations in plain words, and a clock that re-renders without fetching.

import { useEffect, useState } from "react";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function parts(ms: number): { days: number; hours: number; minutes: number } | null {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (safe < MINUTE) return null;
  return { days: Math.floor(safe / DAY), hours: Math.floor((safe % DAY) / HOUR), minutes: Math.floor((safe % HOUR) / MINUTE) };
}

/** "2 d 23 h", "2 h 14 min", "4 min" or "under 1 min" (rounded down, never negative). */
export function formatDuration(ms: number): string {
  const p = parts(ms);
  if (!p) return "under 1 min";
  if (p.days > 0) return p.hours > 0 ? `${p.days} d ${p.hours} h` : `${p.days} d`;
  if (p.hours > 0) return p.minutes > 0 ? `${p.hours} h ${p.minutes} min` : `${p.hours} h`;
  return `${p.minutes} min`;
}

/**
 * A run's own spans, which are often seconds: "under 1 s", "12 s", "4 min 12 s", then as formatDuration
 * from 10 minutes up ("2 h 14 min").
 */
export function formatElapsed(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (safe < 1000) return "under 1 s";
  if (safe < MINUTE) return `${Math.floor(safe / 1000)} s`;
  if (safe < 10 * MINUTE) {
    const seconds = Math.floor((safe % MINUTE) / 1000);
    return seconds > 0 ? `${Math.floor(safe / MINUTE)} min ${seconds} s` : `${Math.floor(safe / MINUTE)} min`;
  }
  return formatDuration(safe);
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** The same duration in words for screen readers: "2 days 23 hours", "2 hours 14 minutes", "under 1 minute". */
export function formatDurationWords(ms: number): string {
  const p = parts(ms);
  if (!p) return "under 1 minute";
  if (p.days > 0) return p.hours > 0 ? `${plural(p.days, "day")} ${plural(p.hours, "hour")}` : plural(p.days, "day");
  if (p.hours > 0) return p.minutes > 0 ? `${plural(p.hours, "hour")} ${plural(p.minutes, "minute")}` : plural(p.hours, "hour");
  return plural(p.minutes, "minute");
}

/** Milliseconds since `iso` at `now`; 0 for a time in the future or an unreadable value. */
export function ageMs(iso: string | null | undefined, now: number): number {
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(at) ? Math.max(0, now - at) : 0;
}

/** The current time, refreshed every `intervalMs`, so ages and countdowns move without a request. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
