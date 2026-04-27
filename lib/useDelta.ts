'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Track changes to a numeric value and return the most recent delta.
 *
 * The delta auto-clears after `clearAfterMs` of stability so users don't
 * stare at a stale "+5" that's actually from minutes ago — once the count
 * settles, the panel returns to its clean resting state. The default 20s
 * window comfortably covers the typical GTFS-RT poll cadence (~30s)
 * without blinking the badge between every refresh.
 *
 * The first observation is treated as the baseline (delta = 0) — there's
 * no delta to compute until we've seen the value change at least once.
 *
 * @param value         The current value to track.
 * @param clearAfterMs  How long (ms) to keep showing the most recent delta
 *                      before reverting to 0. Pass 0 to never auto-clear.
 */
export function useDelta(value: number, clearAfterMs = 20_000): number {
  const [delta, setDelta] = useState(0);
  const prevRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prevRef.current === null) {
      prevRef.current = value;
      return;
    }
    if (prevRef.current === value) return;

    setDelta(value - prevRef.current);
    prevRef.current = value;

    if (timerRef.current) clearTimeout(timerRef.current);
    if (clearAfterMs > 0) {
      timerRef.current = setTimeout(() => setDelta(0), clearAfterMs);
    }
  }, [value, clearAfterMs]);

  // Cancel any pending auto-clear on unmount so the timer doesn't fire
  // against a dead component (React would warn in strict mode otherwise).
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return delta;
}
