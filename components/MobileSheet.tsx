'use client';

import { useState } from 'react';
import type { TrainPosition } from '@/lib/types';
import { ROUTE_GROUPS, getTextColor } from '@/lib/route-colors';
import { useDelta } from '@/lib/useDelta';
import RouteFilter from './RouteFilter';
import DeltaBadge from './DeltaBadge';

interface Props {
  trains: TrainPosition[];
  selectedRoutes: Set<string>;
  onToggle: (routes: string[]) => void;
  onClear: () => void;
}

type Tab = 'lines' | 'stats';

/**
 * Mobile-first bottom sheet that holds the filter and stats panels.
 *
 * Default state on first paint is *collapsed* — just a peek bar showing the
 * total trains and the active filter count. The map gets the entire screen,
 * which matches how Apple Maps / Google Maps treat their info pills on
 * phones. Tapping the peek expands to ~50% of the viewport with a tab
 * switcher between Lines (filter) and Stats (per-line counts).
 */
export default function MobileSheet({
  trains,
  selectedRoutes,
  onToggle,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('lines');

  const filterCount = selectedRoutes.size;

  return (
    <>
      {/* Backdrop when open. Tap to dismiss. */}
      {open && (
        <button
          aria-label="Close panel"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[1050] bg-black/30 backdrop-blur-[1px]"
        />
      )}

      <div
        className={`fixed inset-x-0 bottom-0 z-[1100] transition-transform duration-300 ease-out ${
          open ? 'translate-y-0' : 'translate-y-[calc(100%-3.75rem)]'
        }`}
        role="dialog"
        aria-label="Subway info"
      >
        <div className="bg-white/95 dark:bg-gray-950/95 backdrop-blur-md border-t border-gray-200 dark:border-gray-800 rounded-t-2xl shadow-2xl">
          {/* Peek / handle bar */}
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="w-full flex items-center justify-between px-4 py-3 active:bg-gray-100 dark:active:bg-gray-900/60 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="block w-8 h-1 bg-gray-300 dark:bg-gray-700 rounded-full" aria-hidden="true" />
              <span className="text-gray-800 dark:text-gray-200 text-sm font-medium">
                {trains.length} trains
                {filterCount > 0 && (
                  <span className="text-blue-600 dark:text-blue-400 ml-1.5">· {filterCount} filtered</span>
                )}
              </span>
            </div>
            <span className="text-gray-500 dark:text-gray-400 text-xs">
              {open ? 'Close' : 'Tap to open'}
            </span>
          </button>

          {/* Tab strip + content */}
          <div className="border-t border-gray-200 dark:border-gray-800/80">
            <div role="tablist" className="flex">
              <Tab
                active={tab === 'lines'}
                onClick={() => setTab('lines')}
                label="Lines"
                badge={filterCount > 0 ? filterCount : undefined}
              />
              <Tab
                active={tab === 'stats'}
                onClick={() => setTab('stats')}
                label="Stats"
              />
            </div>

            <div className="px-4 pb-4 pt-2 max-h-[55vh] overflow-y-auto">
              {tab === 'lines' ? (
                <RouteFilter
                  trains={trains}
                  selectedRoutes={selectedRoutes}
                  onToggle={onToggle}
                  onClear={onClear}
                  compact
                />
              ) : (
                <Stats trains={trains} />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Tab({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors relative ${
        active
          ? 'text-gray-900 dark:text-white'
          : 'text-gray-500 hover:text-gray-700 active:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 dark:active:text-gray-100'
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        {typeof badge === 'number' && (
          <span className="bg-blue-600 text-white text-[10px] tabular-nums rounded-full px-1.5 leading-4">
            {badge}
          </span>
        )}
      </span>
      {active && (
        <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-blue-500 rounded-full" />
      )}
    </button>
  );
}

function Stats({ trains }: { trains: TrainPosition[] }) {
  const counts = new Map<string, number>();
  for (const t of trains) {
    const group = ROUTE_GROUPS.find((g) => g.routes.includes(t.routeId));
    if (group) counts.set(group.label, (counts.get(group.label) ?? 0) + 1);
  }
  const stats = ROUTE_GROUPS.map((g) => ({
    label: g.label,
    color: g.color,
    count: counts.get(g.label) ?? 0,
  })).filter((s) => s.count > 0);

  const stoppedCount = trains.filter((t) => t.status === 'STOPPED_AT').length;
  const movingCount = trains.length - stoppedCount;
  const max = Math.max(1, ...stats.map((s) => s.count));

  // Trend deltas (refreshed each GTFS-RT poll, auto-cleared once stable).
  // Tracked here at the parent so unmounting the Stats tab resets the
  // baseline — re-opening the panel shows a fresh, non-stale view.
  const totalDelta = useDelta(trains.length);
  const movingDelta = useDelta(movingCount);
  const stoppedDelta = useDelta(stoppedCount);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Tile
          label="Total"
          value={trains.length}
          accent="text-blue-600 dark:text-blue-400"
          delta={totalDelta}
        />
        <Tile
          label="Moving"
          value={movingCount}
          accent="text-green-600 dark:text-green-400"
          delta={movingDelta}
        />
        <Tile
          label="Stopped"
          value={stoppedCount}
          accent="text-amber-600 dark:text-amber-400"
          delta={stoppedDelta}
        />
      </div>

      <div className="space-y-1">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span
              className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold"
              style={{
                background: s.color,
                color: getTextColor(s.color),
              }}
            >
              {s.label.split('·')[0]}
            </span>
            <span className="text-gray-700 dark:text-gray-300 text-xs w-16 truncate">
              {s.label}
            </span>
            <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, (s.count / max) * 100)}%`,
                  background: s.color,
                }}
              />
            </div>
            <span className="text-gray-700 dark:text-gray-400 text-xs tabular-nums w-6 text-right">
              {s.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
  delta,
}: {
  label: string;
  value: number;
  accent: string;
  delta?: number;
}) {
  return (
    <div className="bg-gray-100 dark:bg-gray-900/60 rounded-lg p-2 text-center relative">
      {typeof delta === 'number' && (
        <DeltaBadge delta={delta} className="absolute top-1 right-1.5" />
      )}
      <p className={`text-lg font-bold tabular-nums leading-none ${accent}`}>
        {value}
      </p>
      <p className="text-gray-500 text-[10px] mt-0.5">{label}</p>
    </div>
  );
}
