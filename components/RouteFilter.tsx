'use client';

import { useMemo } from 'react';
import type { TrainPosition } from '@/lib/types';
import { ROUTE_GROUPS, getTextColor } from '@/lib/route-colors';

interface Props {
  trains: TrainPosition[];
  selectedRoutes: Set<string>;
  onToggle: (routes: string[]) => void;
  onClear: () => void;
  /** Render compactly inside a bottom sheet (mobile). */
  compact?: boolean;
}

/**
 * Route filter panel — desktop left rail + mobile bottom sheet.
 *
 * Three things to know about this component (each one was a real bug):
 *
 * 1. **Don't block event propagation at the panel root.**
 *    React 17+ delegates synthetic events at the React root container.
 *    A naive `addEventListener('click', stopPropagation)` on a wrapping div
 *    looks correct (it stops clicks from leaking to Leaflet) but it also
 *    prevents the event from ever reaching React's delegated listener,
 *    which silently kills every `onClick` inside the panel. The panel here
 *    sits as a *DOM sibling* of `<MapContainer>`, so map listeners can't
 *    see our clicks anyway — we don't need to stop anything.
 *
 * 2. **Sticky `:focus` looks like "still selected".**
 *    After clicking a route chip or "Clear", the browser keeps `:focus` on
 *    the button. With `transition-colors` the lingering hover/focus tint
 *    reads as "the filter is still active", which is exactly the bug users
 *    keep reporting. We call `blur()` synchronously inside the click handler.
 *
 * 3. **Selected vs hover need to be visually distinct.**
 *    The previous selected style (`bg-gray-700/60`) was nearly identical to
 *    the hover style (`bg-gray-800/60`), so a chip with stale focus looked
 *    selected. We use a saturated blue tint for selected so it can never be
 *    confused with hover/focus.
 */
export default function RouteFilter({
  trains,
  selectedRoutes,
  onToggle,
  onClear,
  compact = false,
}: Props) {
  // Memoize train counts per route group to avoid O(groups * trains) on every
  // render. Only recomputes when the trains array reference changes.
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of ROUTE_GROUPS) {
      counts.set(group.label, 0);
    }
    for (const train of trains) {
      for (const group of ROUTE_GROUPS) {
        if (group.routes.includes(train.routeId)) {
          counts.set(group.label, (counts.get(group.label) ?? 0) + 1);
          break;
        }
      }
    }
    return counts;
  }, [trains]);

  const hasSelection = selectedRoutes.size > 0;

  // Wrapped click handlers: stop propagation explicitly + drop focus so the
  // button doesn't keep its `:focus` tint, which users read as "still selected".
  const handleToggle = (e: React.MouseEvent<HTMLButtonElement>, routes: string[]) => {
    e.stopPropagation();
    onToggle(routes);
    e.currentTarget.blur();
  };

  const handleClear = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onClear();
    e.currentTarget.blur();
  };

  return (
    <div
      className={
        compact
          ? 'space-y-1'
          : 'bg-white/90 dark:bg-gray-950/85 backdrop-blur-md rounded-xl p-3 border border-gray-200 dark:border-gray-800 shadow-xl space-y-1'
      }
    >
      {/* Header with Clear button — always at the top, both desktop and mobile.
          Putting Clear at the bottom of the panel created an overlap with the
          Legend on short viewports and a "where did my Clear go?" UX. */}
      <div className={`flex items-center justify-between ${compact ? 'mb-1.5 px-0.5' : 'mb-2'}`}>
        <p className="text-gray-500 dark:text-gray-400 text-xs font-semibold uppercase tracking-wider">
          {compact ? 'Lines' : 'Filter Lines'}
        </p>
        {/* Reserve the slot so the header doesn't jump when Clear appears. */}
        <button
          type="button"
          onClick={handleClear}
          disabled={!hasSelection}
          aria-label="Clear all line filters"
          className={`text-[11px] font-medium transition-opacity rounded px-1.5 py-0.5 ${
            hasSelection
              ? 'text-blue-600 hover:text-blue-700 active:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 dark:active:text-blue-200 opacity-100'
              : 'text-transparent pointer-events-none opacity-0'
          }`}
        >
          Clear
        </button>
      </div>

      <div className={compact ? 'grid grid-cols-2 gap-1.5' : 'space-y-1'}>
        {ROUTE_GROUPS.map((group) => {
          const anySelected = group.routes.some((r) => selectedRoutes.has(r));
          const count = groupCounts.get(group.label) ?? 0;
          return (
            <button
              type="button"
              key={group.label}
              onClick={(e) => handleToggle(e, group.routes)}
              aria-pressed={anySelected}
              className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                anySelected
                  // Selected state — clearly distinct from hover. We use a
                  // saturated blue tint instead of a gray bg so a focused
                  // (but unselected) chip can never be confused with a
                  // selected one.
                  ? 'bg-blue-100 ring-1 ring-blue-400 dark:bg-blue-500/20 dark:ring-blue-400/60'
                  : 'hover:bg-gray-100 active:bg-gray-200 dark:hover:bg-gray-800/60 dark:active:bg-gray-800'
              }`}
            >
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                style={{
                  background: group.color,
                  color: getTextColor(group.color),
                }}
              >
                {group.label.split('·')[0]}
              </span>
              <span className="text-gray-800 dark:text-gray-200 text-xs flex-1 font-medium truncate">
                {group.label}
              </span>
              <span className="text-gray-500 dark:text-gray-500 text-[10px] tabular-nums">
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
