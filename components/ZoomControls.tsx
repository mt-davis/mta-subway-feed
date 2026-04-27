'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

/**
 * Always-visible zoom controls for users without a scroll wheel
 * (touchpads, tablets, accessibility).
 *
 * The default Leaflet zoom buttons live at `bottomright`, where the desktop
 * StatsPanel and the mobile sheet pill both sit — so they were getting
 * physically covered by other UI. We render here at top-right instead,
 * just below the Header, where nothing else competes for the corner.
 *
 * `L.DomEvent.disableClickPropagation` is critical: without it, clicking
 * the buttons also fires a mousedown on the underlying map and gets
 * interpreted as the start of a pan (most noticeable on touchpads).
 */
export default function ZoomControls() {
  const map = useMap();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(() => map.getZoom());

  useEffect(() => {
    const handler = () => setZoom(map.getZoom());
    map.on('zoomend', handler);
    return () => {
      map.off('zoomend', handler);
    };
  }, [map]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);

  const atMin = zoom <= map.getMinZoom();
  const atMax = zoom >= map.getMaxZoom();

  return (
    <div
      ref={wrapRef}
      role="group"
      aria-label="Zoom controls"
      className="
        absolute top-14 right-3 z-[800]
        flex flex-col rounded-lg overflow-hidden shadow-xl
        bg-white/90 dark:bg-gray-950/85 backdrop-blur-md
        border border-gray-200 dark:border-gray-800
      "
    >
      <button
        type="button"
        onClick={() => map.zoomIn()}
        disabled={atMax}
        aria-label="Zoom in"
        title="Zoom in"
        className="
          inline-flex items-center justify-center
          w-9 h-9
          text-gray-700 dark:text-gray-200
          hover:bg-gray-100 dark:hover:bg-gray-800
          disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed
          transition-colors
          focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500
        "
      >
        <PlusIcon />
      </button>
      <div
        className="h-px bg-gray-200 dark:bg-gray-800"
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={() => map.zoomOut()}
        disabled={atMin}
        aria-label="Zoom out"
        title="Zoom out"
        className="
          inline-flex items-center justify-center
          w-9 h-9
          text-gray-700 dark:text-gray-200
          hover:bg-gray-100 dark:hover:bg-gray-800
          disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed
          transition-colors
          focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500
        "
      >
        <MinusIcon />
      </button>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}
