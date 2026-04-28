'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { TrainPosition } from '@/lib/types';
import RouteFilter from './RouteFilter';
import StatsPanel from './StatsPanel';
import Legend from './Legend';
import MobileSheet from './MobileSheet';
import ThemeToggle from './ThemeToggle';

const MapComponent = dynamic(() => import('./MapComponent'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-white dark:bg-gray-950">
      <div className="text-center space-y-3">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          Loading NYC Subway Map…
        </p>
      </div>
    </div>
  ),
});

export default function SubwayMap() {
  const [selectedRoutes, setSelectedRoutes] = useState<Set<string>>(new Set());
  const [trains, setTrains] = useState<TrainPosition[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Show an "Updating map…" pill while the cluster layer is busy reconciling
  // a filter change. Even with batched addLayers, swapping ~500 markers in/out
  // of the cluster index spends a few hundred ms on the main thread; without
  // feedback the user reads it as "the button didn't work".
  //
  // Detection is timer-based, not callback-based: the actual marker work
  // happens inside `AnimatedTrainLayer`'s effect (a child of MapComponent),
  // and plumbing a "done" callback up through the dynamic boundary is more
  // wiring than this UX is worth. Two rAFs put us past the next paint, then
  // an 800ms tail covers chunkedLoading + the deferred-trajectory backfill.
  // 800ms is also above the Doherty perceptual threshold (~400ms) for
  // "deliberate feedback that the system heard you" — anything shorter
  // reads as a flicker on fast monitors.
  const [isUpdatingFilter, setIsUpdatingFilter] = useState(false);
  const filterPillTimerRef = useRef<number | null>(null);
  const filterPillRafRef = useRef<number | null>(null);

  // Cancel any pending pill timers on unmount so we don't setState after unmount.
  useEffect(() => {
    return () => {
      if (filterPillTimerRef.current !== null) {
        window.clearTimeout(filterPillTimerRef.current);
      }
      if (filterPillRafRef.current !== null) {
        window.cancelAnimationFrame(filterPillRafRef.current);
      }
    };
  }, []);

  function showFilterPill() {
    setIsUpdatingFilter(true);

    // Reset any in-flight cleanup so rapid clicks extend the pill duration
    // instead of hiding it mid-update.
    if (filterPillTimerRef.current !== null) {
      window.clearTimeout(filterPillTimerRef.current);
      filterPillTimerRef.current = null;
    }
    if (filterPillRafRef.current !== null) {
      window.cancelAnimationFrame(filterPillRafRef.current);
      filterPillRafRef.current = null;
    }

    // Two rAFs ⇒ React has rendered AND the browser has painted.
    // setTimeout 800 ⇒ chunkedLoading + deferred-trajectory backfill is
    // done for typical bulk diffs. Total visible duration is ~one paint +
    // 800ms — long enough to register as feedback, short enough to clear
    // before the user thinks it's stuck.
    filterPillRafRef.current = window.requestAnimationFrame(() => {
      filterPillRafRef.current = window.requestAnimationFrame(() => {
        filterPillRafRef.current = null;
        filterPillTimerRef.current = window.setTimeout(() => {
          filterPillTimerRef.current = null;
          setIsUpdatingFilter(false);
        }, 800);
      });
    });
  }

  function toggleRoute(routes: string[]) {
    showFilterPill();
    setSelectedRoutes((prev) => {
      const next = new Set(prev);
      const allSelected = routes.every((r) => next.has(r));
      if (allSelected) {
        routes.forEach((r) => next.delete(r));
      } else {
        routes.forEach((r) => next.add(r));
      }
      return next;
    });
  }

  function clearRoutes() {
    showFilterPill();
    setSelectedRoutes(new Set());
  }

  const visibleCount =
    selectedRoutes.size === 0
      ? trains.length
      : trains.filter((t) => selectedRoutes.has(t.routeId)).length;

  return (
    <div className="relative w-full h-screen bg-white dark:bg-gray-950 overflow-hidden">
      {/* Map fills the full screen */}
      <div className="absolute inset-0">
        <MapComponent
          trains={trains}
          selectedRoutes={selectedRoutes}
          onStats={setTrains}
          onLastUpdated={setLastUpdated}
          onError={setError}
          onLoading={setLoading}
        />
      </div>

      {/* Header bar */}
      <Header
        loading={loading}
        error={error}
        visibleCount={visibleCount}
        totalCount={trains.length}
        filtered={selectedRoutes.size > 0}
        lastUpdated={lastUpdated}
      />

      {/* Filter-update feedback. Two complementary indicators:
          1. A thin indeterminate progress bar pinned right under the header
             — the universal "system is working" pattern (GitHub, Stripe, etc.)
             that can never be occluded by map markers.
          2. A centered "Updating map…" pill that names what's happening.
          Both share the same visibility window (`isUpdatingFilter`).
          Pointer-events:none so neither blocks pan/zoom on the map.
          aria-live="polite" so screen readers announce without interrupting. */}
      <UpdatingProgressBar visible={isUpdatingFilter} />
      <UpdatingPill visible={isUpdatingFilter} />

      {/* Desktop: left rail — filter + legend share a single column so they
          never overlap on short viewports. The filter list scrolls if the
          remaining height is tight; the legend stays pinned at the bottom of
          the rail. */}
      <div
        className="hidden sm:flex absolute top-14 bottom-3 left-3 z-[1000] w-44 flex-col gap-2 pointer-events-none"
      >
        <div className="min-h-0 flex-1 overflow-y-auto pointer-events-auto pr-0.5">
          <RouteFilter
            trains={trains}
            selectedRoutes={selectedRoutes}
            onToggle={toggleRoute}
            onClear={clearRoutes}
          />
        </div>
        <div className="pointer-events-auto shrink-0">
          <Legend />
        </div>
      </div>

      {/* Desktop: stats panel (right) */}
      {!loading && !error && trains.length > 0 && (
        <div className="hidden sm:block">
          <StatsPanel trains={trains} />
        </div>
      )}

      {/* Mobile: bottom sheet with tabs for Lines / Stats */}
      <div className="sm:hidden">
        <MobileSheet
          trains={trains}
          selectedRoutes={selectedRoutes}
          onToggle={toggleRoute}
          onClear={clearRoutes}
        />
      </div>

      {/* Error banner */}
      {error && (
        <div className="absolute bottom-24 sm:bottom-4 left-1/2 -translate-x-1/2 z-[1100] max-w-md w-full mx-4">
          <div className="bg-red-50/95 dark:bg-red-950/90 backdrop-blur-md border border-red-300 dark:border-red-800 rounded-xl p-4 text-sm text-red-800 dark:text-red-200 shadow-xl">
            <p className="font-semibold text-red-900 dark:text-red-100 mb-1">
              ⚠️ Data Error
            </p>
            <p>{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 1-second clock for relative timestamps ────────────────────────────────
// useSyncExternalStore is the canonical React 19 way to read a mutable
// external value (Date.now) without breaking purity rules. We cache the
// snapshot so getNow() returns a stable reference between ticks — otherwise
// React warns "The result of getSnapshot should be cached to avoid an
// infinite loop" because Date.now() changes on every call.
let cachedNow = typeof window !== 'undefined' ? Date.now() : 0;
function subscribeToSecondTick(onChange: () => void): () => void {
  const id = setInterval(() => {
    cachedNow = Date.now();
    onChange();
  }, 1000);
  return () => clearInterval(id);
}
function getNow(): number {
  return cachedNow;
}
function getServerNow(): number {
  // SSR snapshot: never used (header lives under a client-only map shell),
  // but useSyncExternalStore requires it. Returning 0 yields ageMs ~= now,
  // which would render as "—" in any case because lastUpdated is null on the
  // server.
  return 0;
}

// ── Indeterminate progress bar ──────────────────────────────────────────────
// Thin (2px) animated bar pinned to the top of the viewport, just under the
// header. This is the most universally recognized "system is working"
// pattern — used by GitHub, Stripe, Notion, every browser. Critically, it's
// pinned to the viewport edge so it can never be occluded by Leaflet markers
// the way a centered pill can.
//
// Mount/unmount on `visible` so the bar's slide animation replays each time.
// Animation is pure CSS (`@keyframes progress-slide`) so it survives React
// StrictMode mount/unmount/remount cycles in dev.
function UpdatingProgressBar({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      aria-hidden="true"
      className="absolute left-0 right-0 z-[1100] h-[3px] overflow-hidden pointer-events-none"
      style={{ top: '52px' }}
    >
      {/* Faint always-on track so the bar is perceptible even when the
          sliding highlight is off-screen between sweeps. */}
      <div className="absolute inset-0 bg-blue-500/30" />
      {/* Sliding highlight — animates from off-screen left to off-screen right
          on a 1.1s loop. The 200% width amplifies the gradient so the bright
          peak feels more pronounced. */}
      <div className="absolute inset-0 animate-progress-slide bg-gradient-to-r from-transparent via-blue-400 to-transparent" />
    </div>
  );
}

// ── "Updating map…" pill ────────────────────────────────────────────────────
// Centered just below the header during filter changes. Larger and more
// prominent than the typical loading toast — the previous 11px version was
// being eaten by cluster icons rendering on top of it. Now uses:
//   • a left-side colored bar in brand blue for instant pattern recognition
//   • backdrop-blur with high opacity so map content behind reads as bg, not
//     compete-for-attention foreground
//   • shadow-2xl + ring for a clear "floating panel" depth cue
//
// We mount/unmount instead of toggling opacity so React doesn't keep an idle
// node in the DOM, and so the entrance animation replays each time the user
// taps a filter chip.
//
// `pointer-events-none` is critical: this element sits over the map at z=1100,
// and we don't want it to swallow pan/zoom gestures the moment it appears.
// Entry animation lives in globals.css as `@keyframes pill-in`. We deliberately
// avoid the useState+rAF "shown" pattern that's common for these — it gets
// cancelled by React StrictMode's mount/unmount/remount cycle, leaving the pill
// permanently invisible at opacity:0. A pure CSS animation runs on mount no
// matter how many times the component mounts.
function UpdatingPill({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute z-[1100] pointer-events-none animate-pill-in"
      style={{ top: '68px', left: '50%', transform: 'translateX(-50%)' }}
    >
      <div className="flex items-center gap-2.5 pl-3 pr-4 py-2 rounded-xl bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border border-blue-500/30 shadow-2xl ring-1 ring-blue-500/10">
        {/* Brand-blue accent bar on the left so the pill reads as "system
            activity" the moment it pops in, even before the user parses the
            text. */}
        <span
          aria-hidden="true"
          className="w-0.5 h-4 rounded-full bg-blue-500"
        />
        <span
          aria-hidden="true"
          className="w-3.5 h-3.5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"
        />
        <span className="text-[12px] font-semibold text-gray-800 dark:text-gray-100 tracking-wide whitespace-nowrap">
          Updating map…
        </span>
      </div>
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────
function Header({
  loading,
  error,
  visibleCount,
  totalCount,
  filtered,
  lastUpdated,
}: {
  loading: boolean;
  error: string | null;
  visibleCount: number;
  totalCount: number;
  filtered: boolean;
  lastUpdated: Date | null;
}) {
  // Subscribe to a 1-second ticking clock so "Updated Ns ago" stays honest
  // without re-rendering the whole tree. useSyncExternalStore is the canonical
  // way to read external mutable values (like Date.now) without violating
  // react-hooks/purity.
  const now = useSyncExternalStore(subscribeToSecondTick, getNow, getServerNow);

  // SSR snapshot returns 0; clamp to null so we render "—" until hydration
  // produces a real timestamp on the client.
  const ageMs = lastUpdated && now > 0 ? now - lastUpdated.getTime() : null;
  const isFresh = ageMs !== null && ageMs < 35_000;
  const ageLabel = ageMs === null
    ? '—'
    : ageMs < 5_000
    ? 'just now'
    : ageMs < 60_000
    ? `${Math.floor(ageMs / 1000)}s ago`
    : `${Math.floor(ageMs / 60_000)}m ago`;

  return (
    <header className="absolute top-0 left-0 right-0 z-[1000] flex items-center justify-between gap-3 px-3 sm:px-4 py-2 bg-white/85 dark:bg-gray-950/85 backdrop-blur-md border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="w-5 h-5 text-white"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </div>
        <div className="min-w-0">
          <h1 className="text-gray-900 dark:text-white font-bold text-sm sm:text-base leading-tight truncate">
            NYC Subway Live
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-[11px] sm:text-xs leading-tight truncate">
            {loading
              ? 'Loading trains…'
              : error
              ? 'Data unavailable'
              : filtered
              ? `${visibleCount} of ${totalCount} trains`
              : `${totalCount} trains active`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 text-xs text-gray-600 dark:text-gray-400 shrink-0">
        <div className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor: error
                ? 'var(--error)'
                : isFresh
                ? 'var(--fresh)'
                : 'var(--stale)',
              animation: !error && isFresh ? 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' : undefined,
            }}
            aria-hidden="true"
          />
          <span className="tabular-nums" aria-live="polite">
            {error ? 'Error' : ageLabel}
          </span>
        </div>
        <span className="hidden md:inline text-gray-400 dark:text-gray-600">·</span>
        <span className="hidden md:inline text-gray-500">
          Refreshes every 30s
        </span>
        {/* Theme toggle sits at the far right of the header so it's always
            reachable on both desktop and mobile without colliding with the
            map's left rail or right-side panels. */}
        <ThemeToggle />
      </div>
    </header>
  );
}
