'use client';

import { ROUTE_COLORS, getTextColor } from '@/lib/route-colors';

/**
 * Marker-state legend (desktop only).
 *
 * Mirrors what's actually drawn on the map by re-using the same CSS classes
 * (`.train-marker`, `.pulse-ring`, `.train-moving`, `.train-cluster`,
 * `.station-dot`) — so any tweak to a marker's look automatically flows
 * into the legend without anyone having to remember to update both places.
 *
 * Sample bullets are picked to look unmistakably like NYC subway icons:
 *   • "1" in IRT red for the at-station example
 *   • "F" in IND orange for the in-transit example
 */
export default function Legend() {
  return (
    <div className="w-44">
      <div className="bg-white/90 dark:bg-gray-950/85 backdrop-blur-md rounded-xl border border-gray-200 dark:border-gray-800 shadow-xl p-3 space-y-2.5">
        <p className="text-gray-500 dark:text-gray-400 text-[10px] font-semibold uppercase tracking-wider">
          Legend
        </p>

        <Row label="At station" icon={<TrainBadge route="1" stopped />} />
        <Row label="In transit" icon={<TrainBadge route="F" />} />
        <Row label="Station" icon={<StationDot />} />
        <Row label="Cluster · zoom in" icon={<ClusterBadge count={12} />} />

        <p className="text-gray-500 dark:text-gray-600 text-[10px] pt-1 border-t border-gray-200 dark:border-gray-800/80">
          Data: MTA GTFS-RT
        </p>
      </div>
    </div>
  );
}

function Row({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <span className="text-gray-700 dark:text-gray-300 text-[11px]">
        {label}
      </span>
    </div>
  );
}

// ── Mini train marker ───────────────────────────────────────────────────────
// Re-uses `.train-marker` + `.train-stopped` / `.train-moving` so the badge
// inherits the exact box-shadow stack, font, and animations from globals.css.
// Inline overrides shrink it to fit the legend column and disable the
// hover-scale (which would otherwise pop the badge out of the panel).
function TrainBadge({
  route,
  stopped = false,
}: {
  route: string;
  stopped?: boolean;
}) {
  const bg = ROUTE_COLORS[route] ?? '#3b82f6';
  const fg = getTextColor(bg);
  return (
    <span
      className={`train-marker ${stopped ? 'train-stopped' : 'train-moving'} legend-marker`}
      style={{
        background: bg,
        color: fg,
        width: 22,
        height: 22,
        fontSize: 10,
      }}
    >
      {stopped && (
        <span className="pulse-ring" style={{ borderColor: bg }} />
      )}
      <span>{route}</span>
    </span>
  );
}

// ── Station dot ─────────────────────────────────────────────────────────────
// Mirrors the SVG circleMarker drawn by `<StationsLayer>`: small filled dot
// with a thin contrast ring. Colors come from the `.station-dot` rule, which
// flips on theme change — we hand-pick equivalent Tailwind utilities here so
// the legend follows the same dark/light swap.
function StationDot() {
  return (
    <span
      className="block rounded-full bg-gray-900 dark:bg-gray-50 ring-1 ring-gray-50 dark:ring-gray-900"
      style={{ width: 8, height: 8 }}
      aria-hidden="true"
    />
  );
}

// ── Cluster badge ───────────────────────────────────────────────────────────
// Re-uses `.train-cluster` so the conic-gradient rim and theme-aware fill
// match the real cluster icon. Sample colors echo the busiest IRT/IND/BMT
// trunks (red·green·blue·orange) so the rim reads "ring of routes".
function ClusterBadge({ count }: { count: number }) {
  const accent = ['#EE352E', '#00933C', '#0039A6', '#FF6319'];
  const conic = accent
    .map((c, i) => {
      const start = (i / accent.length) * 360;
      const end = ((i + 1) / accent.length) * 360;
      return `${c} ${start}deg ${end}deg`;
    })
    .join(', ');

  return (
    <span
      className="train-cluster"
      style={
        {
          width: 24,
          height: 24,
          '--rim': `conic-gradient(${conic})`,
        } as React.CSSProperties
      }
    >
      <span
        className="train-cluster-count"
        style={{ fontSize: 10 }}
      >
        {count}
      </span>
    </span>
  );
}
