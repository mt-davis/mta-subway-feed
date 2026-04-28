"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useRouter } from "next/navigation";
import { STATIONS_WITH_3D } from "@/lib/station3d/registry";

/**
 * Adds a special "3D" pill marker on top of the 2D map for every station
 * we have a 3D model for. Click → navigate to /station/<id>/3d.
 *
 * Renders nothing in the React tree — all DOM is owned by Leaflet so this
 * doesn't fight with the existing layer ordering or the cluster index.
 */
export function Station3DMarkersLayer() {
  const map = useMap();
  const router = useRouter();

  useEffect(() => {
    const markers: L.Marker[] = [];

    for (const station of STATIONS_WITH_3D) {
      const icon = L.divIcon({
        className: "station-3d-marker",
        // Inline styles only — Tailwind JIT can't see classes inside DivIcon
        // HTML strings, so anything we want to style here has to be inline.
        html: `
          <div class="station-3d-pill" title="${station.name} — Open 3D view">
            <div class="station-3d-glow" aria-hidden="true"></div>
            <div class="station-3d-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:10px;height:10px;display:inline-block;vertical-align:-1px;margin-right:3px">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>3D
            </div>
          </div>
        `,
        iconSize: [44, 24],
        iconAnchor: [22, 12],
      });

      const marker = L.marker([station.position.lat, station.position.lon], {
        icon,
        // Stay above station dots and route shape lines, but below
        // open popups so they don't get covered.
        zIndexOffset: 900,
        riseOnHover: true,
        title: `${station.name} — Open 3D view`,
      });

      marker.bindTooltip(`${station.name}<br/><span style="opacity:0.7">Click to open 3D view</span>`, {
        direction: "top",
        offset: [0, -8],
        opacity: 0.95,
      });

      // Wire navigation at the DOM level rather than via marker.on('click'),
      // because:
      //   1. Real mouse/touch clicks on a DivIcon's HTML hit the DOM directly
      //      — Leaflet's synthesized click can race with map pan handlers and
      //      occasionally fail to fire on rapid taps.
      //   2. Accessibility tooling and automated tests (synth-click) only see
      //      DOM events, not Leaflet's internal event bus.
      // disableClickPropagation prevents the map from interpreting the click
      // as a "click on background" (which would close any open popups, pan
      // toward the click point, etc.).
      const navigate = () => router.push(`/station/${station.id}/3d`);
      marker.on("add", () => {
        const el = marker.getElement();
        if (!el) return;
        L.DomEvent.disableClickPropagation(el);
        el.style.cursor = "pointer";
        el.setAttribute("role", "button");
        el.setAttribute("tabindex", "0");
        el.setAttribute("aria-label", `${station.name} — Open 3D view`);
        el.addEventListener("click", navigate);
        el.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            navigate();
          }
        });
      });

      marker.addTo(map);
      markers.push(marker);
    }

    return () => {
      for (const m of markers) m.remove();
    };
  }, [map, router]);

  return null;
}
