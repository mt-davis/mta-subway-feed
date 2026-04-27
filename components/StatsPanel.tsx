'use client';

import { useMemo } from 'react';
import type { TrainPosition } from '@/lib/types';
import { ROUTE_GROUPS, getTextColor } from '@/lib/route-colors';
import { useDelta } from '@/lib/useDelta';
import DeltaBadge from './DeltaBadge';

interface Props {
  trains: TrainPosition[];
}

export default function StatsPanel({ trains }: Props) {
  const stats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of trains) {
      const group = ROUTE_GROUPS.find((g) => g.routes.includes(t.routeId));
      if (group) {
        counts.set(group.label, (counts.get(group.label) ?? 0) + 1);
      }
    }

    return ROUTE_GROUPS.map((g) => ({
      label: g.label,
      color: g.color,
      count: counts.get(g.label) ?? 0,
    })).filter((s) => s.count > 0);
  }, [trains]);

  const stoppedCount = trains.filter((t) => t.status === 'STOPPED_AT').length;
  const movingCount = trains.length - stoppedCount;

  // Trend deltas (refreshed each GTFS-RT poll, auto-cleared once stable).
  const totalDelta = useDelta(trains.length);
  const movingDelta = useDelta(movingCount);

  return (
    <div className="absolute bottom-6 right-3 z-[1000] w-48">
      <div className="bg-white/90 dark:bg-gray-950/85 backdrop-blur-md rounded-xl border border-gray-200 dark:border-gray-800 shadow-xl p-3 space-y-3">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-100 dark:bg-gray-900/60 rounded-lg p-2 text-center relative">
            <DeltaBadge delta={totalDelta} className="absolute top-1 right-1.5" />
            <p className="text-blue-600 dark:text-blue-400 text-lg font-bold tabular-nums leading-none">
              {trains.length}
            </p>
            <p className="text-gray-500 text-[10px] mt-0.5">Total</p>
          </div>
          <div className="bg-gray-100 dark:bg-gray-900/60 rounded-lg p-2 text-center relative">
            <DeltaBadge delta={movingDelta} className="absolute top-1 right-1.5" />
            <p className="text-green-600 dark:text-green-400 text-lg font-bold tabular-nums leading-none">
              {movingCount}
            </p>
            <p className="text-gray-500 text-[10px] mt-0.5">Moving</p>
          </div>
        </div>

        {/* Per-line counts */}
        <div>
          <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wider mb-1.5">
            By Line
          </p>
          <div className="space-y-1">
            {stats.map((s) => (
              <div key={s.label} className="flex items-center gap-2">
                <span
                  className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[8px] font-bold"
                  style={{
                    background: s.color,
                    color: getTextColor(s.color),
                  }}
                >
                  {s.label.split('·')[0]}
                </span>
                <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (s.count / Math.max(...stats.map((x) => x.count))) * 100)}%`,
                      background: s.color,
                    }}
                  />
                </div>
                <span className="text-gray-700 dark:text-gray-400 text-[10px] tabular-nums w-5 text-right">
                  {s.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-gray-500 dark:text-gray-600 text-[10px] text-center">
          Data: MTA GTFS-RT
        </p>
      </div>
    </div>
  );
}
