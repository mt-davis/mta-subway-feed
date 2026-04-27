'use client';

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

export default function RouteFilter({
  trains,
  selectedRoutes,
  onToggle,
  onClear,
  compact = false,
}: Props) {
  return (
    <div
      className={
        compact
          ? 'space-y-1'
          : 'bg-white/90 dark:bg-gray-950/85 backdrop-blur-md rounded-xl p-3 border border-gray-200 dark:border-gray-800 shadow-xl space-y-1'
      }
    >
      {!compact && (
        <p className="text-gray-500 dark:text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">
          Filter Lines
        </p>
      )}
      <div className={compact ? 'grid grid-cols-2 gap-1.5' : 'space-y-1'}>
        {ROUTE_GROUPS.map((group) => {
          const anySelected = group.routes.some((r) => selectedRoutes.has(r));
          const count = trains.filter((t) =>
            group.routes.includes(t.routeId),
          ).length;
          return (
            <button
              key={group.label}
              onClick={() => onToggle(group.routes)}
              aria-pressed={anySelected}
              className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                anySelected
                  ? 'bg-gray-200/80 ring-1 ring-gray-400 dark:bg-gray-700/60 dark:ring-gray-500'
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

      {selectedRoutes.size > 0 && (
        <button
          onClick={onClear}
          className="mt-2 w-full text-center text-xs text-blue-600 hover:text-blue-700 active:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 dark:active:text-blue-200 transition-colors"
        >
          Show all lines
        </button>
      )}
    </div>
  );
}
