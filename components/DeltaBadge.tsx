'use client';

interface Props {
  delta: number;
  className?: string;
}

/**
 * Tiny up/down trend chip rendered alongside count tiles in the stats
 * panels. Hidden when delta is 0 so the resting state stays clean — the
 * arrow only appears when there's actually a change worth showing.
 *
 * Color + arrow direction encode sign together (▲ green for increase,
 * ▼ rose for decrease), so the chip remains unambiguous even for
 * color-blind users who only see the glyph.
 */
export default function DeltaBadge({ delta, className = '' }: Props) {
  if (delta === 0) return null;
  const positive = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums leading-none ${
        positive
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-rose-600 dark:text-rose-400'
      } ${className}`}
      aria-label={`${positive ? 'Up' : 'Down'} ${Math.abs(delta)} since last update`}
    >
      <span aria-hidden="true">{positive ? '▲' : '▼'}</span>
      {Math.abs(delta)}
    </span>
  );
}
