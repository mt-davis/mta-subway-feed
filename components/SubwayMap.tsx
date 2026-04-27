'use client';

import dynamic from 'next/dynamic';
import { useState, useSyncExternalStore } from 'react';
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

  function toggleRoute(routes: string[]) {
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

      {/* Desktop: left rail — filter + legend share a single column so they
          never overlap on short viewports. The filter list scrolls if the
          remaining height is tight; the legend stays pinned at the bottom of
          the rail. */}
      <div
        className="hidden sm:flex absolute top-14 bottom-3 left-3 z-[1000] w-44 flex-col gap-2 pointer-events-none"
      >
        <div className="min-h-0 overflow-y-auto pointer-events-auto pr-0.5">
          <RouteFilter
            trains={trains}
            selectedRoutes={selectedRoutes}
            onToggle={toggleRoute}
            onClear={clearRoutes}
          />
        </div>
        <div className="pointer-events-auto mt-auto">
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
            className={`w-2 h-2 rounded-full ${
              error
                ? 'bg-red-500'
                : isFresh
                ? 'bg-green-500 animate-pulse'
                : 'bg-amber-500'
            }`}
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
