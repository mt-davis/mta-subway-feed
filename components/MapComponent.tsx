'use client';

import { useEffect, useRef, useCallback, useState, useSyncExternalStore } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.markercluster';
import {
  getResolvedTheme,
  getResolvedThemeServerSnapshot,
  subscribeToTheme,
} from '@/lib/theme';
// Named imports tree-shake out unused turf modules (large win for bundle size).
import {
  along,
  length,
  lineSlice,
  lineString,
  nearestPointOnLine,
  point,
  pointToLineDistance,
} from '@turf/turf';
// Leaflet + markercluster CSS are imported in app/layout.tsx (before
// globals.css) so our dark popup/cluster overrides win at equal specificity.
import type { Station, TrainPosition, TrainsApiResponse } from '@/lib/types';
import type { RouteGeoFeature } from '@/lib/gtfs-static';
import { Station3DMarkersLayer } from '@/components/station3d/MapMarkersLayer';
import ZoomControls from './ZoomControls';
import { getRouteColor, getTextColor } from '@/lib/route-colors';

const REFRESH_INTERVAL = 30_000;
const NYC_CENTER: [number, number] = [40.7128, -74.006];
// Hard-clamp the map to the NYC subway service area. Without this, the user
// can pan into the Atlantic or zoom out to a globe view, both of which are
// pure footguns: there are no trains to see out there. Padded ~15km past the
// actual subway extent so the buffer feels generous, not claustrophobic.
const NYC_BOUNDS: L.LatLngBoundsLiteral = [
  [40.45, -74.30], // SW: south of Coney Island, west of Bayonne
  [41.05, -73.65], // NE: north of Wakefield, east of Far Rockaway
];
// Zoom 10 fits all five boroughs in a typical desktop viewport and keeps tile
// detail meaningful. Anything lower just shows ocean on either side.
const NYC_MIN_ZOOM = 10;
const ARRIVE_DURATION = 500;
const DEPART_DURATION = 350;
// Cluster trains until the user zooms in close enough that overlap stops
// being a problem. Below this zoom level, RAF position updates are
// throttled to avoid hammering the cluster index every frame.
const CLUSTER_DISABLE_ZOOM = 14;
const CLUSTER_TICK_MIN_INTERVAL_MS = 500;

// Fallback ETA when TripUpdate doesn't provide one (median NYC inter-station time)
const FALLBACK_SEGMENT_SECONDS = 120;

// Typical NYC subway average speed including dwell time (~30 km/h ≈ 8.3 m/s).
// Used to back-derive a plausible origin point for first-sighting moving trains.
const ESTIMATED_SPEED_MPS = 8.3;
// Cap how far back we walk along the line so a stale ETA can't fling a train across the map.
const MAX_BACKTRACK_KM = 2.0;
// Hard ceiling on animated speed (~50 mph). Defensive backstop against bad
// expectedArrival values that would otherwise blur a train across the map.
// NYC subway operational max is ~55 mph; typical inter-station is 5–15 m/s.
const MAX_SPEED_MPS = 22;

// ── Utility: easing functions for entrance / exit only ───────────────────────
function easeOutBack(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function easeInQuad(t: number): number { return t * t; }

// ── Per-route polyline cache (built once shapes load) ────────────────────────
type LineFeature = GeoJSON.Feature<GeoJSON.LineString>;
type RouteLines = Map<string, LineFeature[]>;

/** Build a flat array of LineStrings for each route. */
function buildRouteLines(features: RouteGeoFeature[]): RouteLines {
  const out: RouteLines = new Map();
  for (const f of features) {
    const list: LineFeature[] = [];
    for (const coords of f.geometry.coordinates) {
      if (coords.length < 2) continue;
      list.push(lineString(coords));
    }
    out.set(f.properties.routeId, list);
  }
  return out;
}

/** Pick the route LineString closest to both endpoints; null if none plausibly fit. */
function pickClosestLine(
  lines: LineFeature[],
  fromLatLon: [number, number],
  toLatLon: [number, number],
): { line: LineFeature; score: number } | null {
  const a = point([fromLatLon[1], fromLatLon[0]]);
  const b = point([toLatLon[1], toLatLon[0]]);
  let bestLine: LineFeature | null = null;
  let bestScore = Infinity;
  for (const line of lines) {
    const dA = pointToLineDistance(a, line, { units: 'kilometers' });
    const dB = pointToLineDistance(b, line, { units: 'kilometers' });
    const score = Math.max(dA, dB);
    if (score < bestScore) {
      bestScore = score;
      bestLine = line;
    }
  }
  // Reject if the snap is implausibly far (> 500m for either endpoint).
  if (!bestLine || bestScore > 0.5) return null;
  return { line: bestLine, score: bestScore };
}

// ── Per-train trajectory cached on each marker ───────────────────────────────
interface Trajectory {
  /** Sliced LineString from current stop projection → next stop projection */
  slice: LineFeature;
  /**
   * The route polyline this slice was cut from. Cached so subsequent rebuilds
   * snap to the *same* line, preventing micro-jumps when a route has multiple
   * overlapping shape variants (express/local, alt terminals, etc).
   */
  sourceLine: LineFeature;
  /** Length of the slice in km */
  lengthKm: number;
  /** Epoch seconds when the train departed the current stop */
  startTime: number;
  /** Epoch seconds when the train should reach the next stop */
  endTime: number;
}

interface TrainEntry {
  marker: L.Marker;
  data: TrainPosition;
  trajectory: Trajectory | null;
  /**
   * When true, the RAF loop leaves this marker in place. Used while the
   * cursor is hovering the marker or its popup is open, so the user has a
   * stable target to click and a stable anchor to read.
   */
  frozen?: boolean;
}

/**
 * Build a Trajectory snapped to a route polyline.
 * `from`/`to` are [lat, lon] of the segment endpoints.
 *
 * If `preferredLine` is provided and still plausibly fits the new target,
 * we re-use it — this keeps the marker visually stable across rebuilds since
 * the previous frame's position is already exactly on that line.
 */
function buildTrajectory(
  from: [number, number],
  to: [number, number],
  routeId: string,
  startTime: number,
  endTime: number,
  routeLines: RouteLines,
  preferredLine?: LineFeature | null,
): Trajectory | null {
  let sourceLine: LineFeature | null = null;

  if (preferredLine) {
    const dFrom = pointToLineDistance(point([from[1], from[0]]), preferredLine, {
      units: 'kilometers',
    });
    const dTo = pointToLineDistance(point([to[1], to[0]]), preferredLine, {
      units: 'kilometers',
    });
    // Stay on the previous polyline as long as both endpoints are reasonably
    // close to it. NYC has lots of overlapping shape variants per route
    // (express/local, alt terminals); without this stickiness, pickClosestLine
    // flips between near-identical lines on every refresh and the marker
    // visibly snaps to the new line each time.
    if (Math.max(dFrom, dTo) <= 1.0) sourceLine = preferredLine;
  }

  if (!sourceLine) {
    const lines = routeLines.get(routeId);
    if (!lines || lines.length === 0) return null;
    const best = pickClosestLine(lines, from, to);
    if (!best) return null;
    sourceLine = best.line;
  }

  const startSnap = nearestPointOnLine(sourceLine, point([from[1], from[0]]));
  const endSnap = nearestPointOnLine(sourceLine, point([to[1], to[0]]));
  let slice: LineFeature;
  try {
    slice = lineSlice(startSnap, endSnap, sourceLine);
  } catch {
    return null;
  }

  const lengthKm = length(slice, { units: 'kilometers' });
  if (lengthKm < 0.005) return null;

  return { slice, sourceLine, lengthKm, startTime, endTime };
}

/**
 * For a first-sighting moving train, estimate where it came from by walking
 * back along the closest route line by ~ETA × average speed. Falls back to
 * the target itself if the route geometry isn't available.
 */
function estimateOrigin(
  target: [number, number],
  routeId: string,
  secondsUntilArrival: number,
  routeLines: RouteLines,
): [number, number] {
  const lines = routeLines.get(routeId);
  if (!lines || lines.length === 0) return target;

  // Find the line closest to the target
  const targetPt = point([target[1], target[0]]);
  let bestLine: LineFeature | null = null;
  let bestDist = Infinity;
  for (const line of lines) {
    const d = pointToLineDistance(targetPt, line, { units: 'kilometers' });
    if (d < bestDist) {
      bestDist = d;
      bestLine = line;
    }
  }
  if (!bestLine || bestDist > 0.5) return target;

  // Snap target onto the line, then walk both directions ~ETA × speed and pick
  // the direction whose start point is farther from the target (i.e. behind).
  const snap = nearestPointOnLine(bestLine, targetPt);
  const distAlong = snap.properties?.location ?? 0;
  const backtrackKm = Math.min(
    Math.max(secondsUntilArrival * ESTIMATED_SPEED_MPS, 200) / 1000,
    MAX_BACKTRACK_KM,
  );

  const candA = along(bestLine, Math.max(0, distAlong - backtrackKm), {
    units: 'kilometers',
  });
  const totalLen = length(bestLine, { units: 'kilometers' });
  const candB = along(bestLine, Math.min(totalLen, distAlong + backtrackKm), {
    units: 'kilometers',
  });

  // Pick whichever candidate gives a usable slice back to the target. Either
  // direction works visually — the train will move toward its target.
  const [aLon, aLat] = candA.geometry.coordinates;
  const [bLon, bLat] = candB.geometry.coordinates;
  // Prefer the candidate that isn't equal to the target.
  const aDist = Math.hypot(aLon - target[1], aLat - target[0]);
  const bDist = Math.hypot(bLon - target[1], bLat - target[0]);
  return aDist > bDist ? [aLat, aLon] : [bLat, bLon];
}

/** Compute current [lat, lon] for a train at wall-clock time `nowSec`. */
function positionAt(entry: TrainEntry, nowSec: number): [number, number] {
  const { trajectory, data } = entry;
  if (!trajectory) return [data.lat, data.lon];

  const total = trajectory.endTime - trajectory.startTime;
  const elapsed = nowSec - trajectory.startTime;
  const frac = total > 0 ? Math.min(Math.max(elapsed / total, 0), 1) : 1;

  const pt = along(trajectory.slice, frac * trajectory.lengthKm, {
    units: 'kilometers',
  });
  const [lon, lat] = pt.geometry.coordinates;
  return [lat, lon];
}

// ── Icon factory ─────────────────────────────────────────────────────────────
/**
 * Map raw GTFS route IDs to the labels MTA actually shows riders.
 *
 * The realtime feed uses internal codes that don't match the wayfinding signs:
 *   • Express variants get an "X" suffix (6X, 7X, FX) — riders just see "6", "7", "F".
 *     Locals and expresses share the same bullet on the MTA map; only the shape
 *     (circle vs diamond) differs, and we don't model that here.
 *   • Shuttle codes "GS" (Grand Central) and "FS" (Franklin Av) are both branded
 *     as "S" — same gray bullet on every station sign.
 *
 * SIR, H, and the rest pass through unchanged.
 */
function displayRouteLabel(routeId: string): string {
  if (routeId === 'GS' || routeId === 'FS') return 'S';
  return routeId.replace(/X$/, '');
}

function isExpressVariant(routeId: string): boolean {
  return /X$/.test(routeId);
}

function createIcon(routeId: string, status: TrainPosition['status']): L.DivIcon {
  const bg = getRouteColor(routeId);
  const fg = getTextColor(bg);
  const display = displayRouteLabel(routeId);
  // SIR is the only label still longer than 2 chars after cleanup; truncate it
  // to keep the badge legible at 28x28.
  const label = display.length > 2 ? display.slice(0, 2) : display;
  const isStopped = status === 'STOPPED_AT';

  return L.divIcon({
    html: `<div class="train-marker ${isStopped ? 'train-stopped' : 'train-moving'}"
                style="background:${bg};color:${fg};">
             ${isStopped ? `<div class="pulse-ring" style="border-color:${bg};"></div>` : ''}
             <span>${label}</span>
           </div>`,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -18],
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function relativeTime(deltaSec: number): string {
  if (deltaSec < 0) {
    const past = -deltaSec;
    if (past < 60) return `${past}s ago`;
    if (past < 3600) return `${Math.floor(past / 60)}m ago`;
    return `${Math.floor(past / 3600)}h ago`;
  }
  if (deltaSec < 60) return `${deltaSec}s`;
  if (deltaSec < 3600) {
    const m = Math.floor(deltaSec / 60);
    const s = deltaSec % 60;
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  return `${Math.floor(deltaSec / 3600)}h`;
}

function buildPopup(t: TrainPosition): string {
  const bg = getRouteColor(t.routeId);
  const fg = getTextColor(bg);
  const isStopped = t.status === 'STOPPED_AT';
  const isIncoming = t.status === 'INCOMING_AT';

  const statusBadge = isStopped
    ? { label: 'At station', color: '#22c55e' }
    : isIncoming
    ? { label: 'Arriving', color: '#f59e0b' }
    : { label: 'In transit', color: '#3b82f6' };

  const nowSec = Math.floor(Date.now() / 1000);
  const ageSec = nowSec - t.timestamp;
  const ageLabel = relativeTime(-ageSec);

  // ETA row (only meaningful for moving trains with a known expectedArrival)
  let etaRow = '';
  if (!isStopped && t.expectedArrival) {
    const etaSec = t.expectedArrival - nowSec;
    if (etaSec > 0) {
      etaRow = `
        <div class="train-popup-row">
          <span class="train-popup-label">ETA</span>
          <span class="train-popup-value train-popup-eta">${relativeTime(etaSec)}</span>
        </div>`;
    }
  }

  // Prefer the trip's terminal stop ("To Wakefield-241 St") because that's how
  // every rider-facing surface in the system labels direction — countdown
  // clocks, platform signs, train roll signs. Fall back to the cardinal
  // direction (N/S) only if the feed didn't include enough TripUpdate data
  // to resolve a headsign.
  let dirRowLabel: string | null = null;
  let dirRowValue: string | null = null;
  if (t.headsign) {
    dirRowLabel = 'To';
    dirRowValue = t.headsign;
  } else if (t.direction === 'N') {
    dirRowLabel = 'Direction';
    dirRowValue = 'Northbound';
  } else if (t.direction === 'S') {
    dirRowLabel = 'Direction';
    dirRowValue = 'Southbound';
  }
  const dirRow = dirRowLabel && dirRowValue
    ? `
      <div class="train-popup-row">
        <span class="train-popup-label">${dirRowLabel}</span>
        <span class="train-popup-value">${escapeHtml(dirRowValue)}</span>
      </div>`
    : '';

  const stopVerb = isStopped ? 'At' : isIncoming ? 'Arriving at' : 'Next stop';
  const niceRoute = displayRouteLabel(t.routeId);
  const expressTag = isExpressVariant(t.routeId)
    ? ' <span class="train-popup-express">Express</span>'
    : '';

  return `
    <div class="train-popup">
      <div class="train-popup-head">
        <div class="train-popup-bullet" style="background:${bg};color:${fg};">
          ${escapeHtml(niceRoute)}
        </div>
        <div class="train-popup-title">
          <div class="train-popup-route">${escapeHtml(niceRoute)} Train${expressTag}</div>
          <div class="train-popup-status" style="color:${statusBadge.color};">
            <span class="train-popup-dot" style="background:${statusBadge.color};"></span>
            ${statusBadge.label}
          </div>
        </div>
      </div>
      <div class="train-popup-body">
        <div class="train-popup-row">
          <span class="train-popup-label">${stopVerb}</span>
          <span class="train-popup-value train-popup-stop">${escapeHtml(t.stopName)}</span>
        </div>
        ${dirRow}
        ${etaRow}
      </div>
      <div class="train-popup-foot">Updated ${ageLabel}</div>
    </div>`;
}

// ── Entrance / exit DOM animations ───────────────────────────────────────────
function animateEntrance(el: HTMLElement) {
  const start = performance.now();
  function tick(now: number) {
    const t = easeOutBack(Math.min((now - start) / ARRIVE_DURATION, 1));
    el.style.opacity = String(Math.min(t, 1));
    el.style.transform = `scale(${0.2 + 0.8 * t})`;
    if (t < 1) requestAnimationFrame(tick);
    else { el.style.opacity = ''; el.style.transform = ''; }
  }
  el.style.opacity = '0';
  el.style.transform = 'scale(0.2)';
  requestAnimationFrame(tick);
}

function animateExit(el: HTMLElement, onDone: () => void) {
  const start = performance.now();
  function tick(now: number) {
    const t = easeInQuad(Math.min((now - start) / DEPART_DURATION, 1));
    el.style.opacity = String(1 - t);
    el.style.transform = `scale(${1 - 0.6 * t})`;
    if (t < 1) requestAnimationFrame(tick);
    else onDone();
  }
  requestAnimationFrame(tick);
}

// ── Zoom control (imperative) ────────────────────────────────────────────────
// ── Stations layer ──────────────────────────────────────────────────────────
// Renders parent-station dots from /api/stations as small white-rimmed circles.
// Hidden at the city-overview zooms (where dots would just be noise on top of
// the route polylines) and faded in around neighborhood-level zoom. We use
// circleMarker rather than divIcon to keep the DOM cheap — there are ~470
// parent stations and a circleMarker is ~10× cheaper than a divIcon marker.
//
// Pane is set to a dedicated 'stations' pane between overlayPane (lines, z=400)
// and markerPane (trains, z=600), so dots sit on the lines but under the trains.
const STATION_MIN_ZOOM = 12;

function StationsLayer() {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [stations, setStations] = useState<Station[] | null>(null);

  // Fetch once. Stations are static for the lifetime of a GTFS static drop, so
  // there's nothing to revalidate inside a session.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/stations')
      .then((r) => r.json())
      .then((data: { stations: Station[] }) => {
        if (!cancelled) setStations(data.stations ?? []);
      })
      .catch((err) => console.warn('Failed to load stations:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  // Make sure our pane exists and sits between lines and trains.
  useEffect(() => {
    if (!map.getPane('stations')) {
      const pane = map.createPane('stations');
      pane.style.zIndex = '450';
      pane.style.pointerEvents = 'auto';
    }
  }, [map]);

  // Build / rebuild the layer when stations arrive.
  useEffect(() => {
    if (!stations) return;

    const group = L.layerGroup([], { pane: 'stations' });
    for (const s of stations) {
      const marker = L.circleMarker([s.lat, s.lon], {
        radius: 3,
        weight: 1.25,
        // Stroke / fill colors live in globals.css under `.station-dot` so they
        // re-color instantly on theme toggle without rebuilding the layer.
        className: 'station-dot',
        pane: 'stations',
      });
      marker.bindTooltip(s.name, {
        direction: 'top',
        offset: [0, -4],
        opacity: 0.95,
        className: 'station-tooltip',
      });
      group.addLayer(marker);
    }

    const apply = () => {
      const z = map.getZoom();
      if (z >= STATION_MIN_ZOOM) {
        if (!map.hasLayer(group)) group.addTo(map);
        // Scale radius with zoom so dots feel proportional rather than fixed.
        const radius = z >= 15 ? 5 : z >= 14 ? 4 : 3;
        group.eachLayer((l) => {
          (l as L.CircleMarker).setRadius(radius);
        });
      } else if (map.hasLayer(group)) {
        group.removeFrom(map);
      }
    };

    apply();
    map.on('zoomend', apply);
    layerRef.current = group;

    return () => {
      map.off('zoomend', apply);
      group.removeFrom(map);
      layerRef.current = null;
    };
  }, [map, stations]);

  return null;
}

// ── Subway lines (route polylines) ───────────────────────────────────────────
function SubwayLinesLayer({
  selectedRoutes,
  onShapesLoaded,
}: {
  selectedRoutes: Set<string>;
  onShapesLoaded: (lines: RouteLines) => void;
}) {
  const map = useMap();
  const geoJsonLayer = useRef<L.GeoJSON | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/shapes')
      .then((r) => r.json())
      .then((data: { features: RouteGeoFeature[] }) => {
        if (cancelled) return;

        const layer = L.geoJSON(data as unknown as GeoJSON.GeoJsonObject, {
          style: (feature) => lineStyle(feature as RouteGeoFeature, selectedRoutes),
          interactive: false,
          pane: 'overlayPane',
        }).addTo(map);

        geoJsonLayer.current = layer;
        onShapesLoaded(buildRouteLines(data.features));
      })
      .catch((err) => console.warn('Failed to load route shapes:', err));

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    const layer = geoJsonLayer.current;
    if (!layer) return;
    layer.eachLayer((l) => {
      const feature = (l as L.Polyline).feature as RouteGeoFeature | undefined;
      if (!feature) return;
      (l as L.Polyline).setStyle(lineStyle(feature, selectedRoutes));
    });
  }, [selectedRoutes]);

  useEffect(() => {
    return () => { geoJsonLayer.current?.remove(); geoJsonLayer.current = null; };
  }, [map]);

  return null;
}

function lineStyle(f: RouteGeoFeature, selectedRoutes: Set<string>): L.PathOptions {
  const { color, routeId } = f.properties;
  const isSelected = selectedRoutes.size === 0 || selectedRoutes.has(routeId);
  return {
    color,
    weight: isSelected ? 4 : 1.75,
    opacity: isSelected ? 0.82 : 0.22,
    lineJoin: 'round',
    lineCap: 'round',
  };
}

// ── Cluster icon factory ────────────────────────────────────────────────────
// Builds a count-badge icon whose size scales with the cluster's child count.
// The route-color dot ring at the edge gives a quick read on what lines are
// represented. Children are not full route badges (would defeat the purpose
// of clustering) — just a hint at the mix.
function createClusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const count = cluster.getChildCount();
  const sizeClass = count < 10 ? 'sm' : count < 50 ? 'md' : count < 200 ? 'lg' : 'xl';

  // Sample up to 6 unique route colors from children for the rim accent.
  const colors = new Set<string>();
  const children = cluster.getAllChildMarkers();
  for (const child of children) {
    const routeId = (child as L.Marker & { _routeId?: string })._routeId;
    if (routeId) colors.add(getRouteColor(routeId));
    if (colors.size >= 6) break;
  }
  const accent = Array.from(colors);
  const conicStops =
    accent.length === 0
      ? '#3b82f6, #3b82f6'
      : accent.length === 1
      ? `${accent[0]}, ${accent[0]}`
      : accent
          .map((c, i) => {
            const start = (i / accent.length) * 360;
            const end = ((i + 1) / accent.length) * 360;
            return `${c} ${start}deg ${end}deg`;
          })
          .join(', ');

  return L.divIcon({
    html: `<div class="train-cluster train-cluster-${sizeClass}"
                style="--rim:conic-gradient(${conicStops});">
             <span class="train-cluster-count">${count}</span>
           </div>`,
    className: 'train-cluster-wrap',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

// ── Animated train layer (continuous RAF, line-snapped) ──────────────────────
function AnimatedTrainLayer({
  trains,
  routeLines,
}: {
  trains: TrainPosition[];
  routeLines: RouteLines | null;
}) {
  const map = useMap();
  const entries = useRef(new Map<string, TrainEntry>());
  const rafId = useRef<number>(0);
  const clusterGroup = useRef<L.MarkerClusterGroup | null>(null);

  // Create the cluster group once. Configured to disappear at high zoom
  // so individual trains are clearly visible when the user zooms in.
  useEffect(() => {
    const group = L.markerClusterGroup({
      disableClusteringAtZoom: CLUSTER_DISABLE_ZOOM,
      // Stop spider-fying at the same threshold; just zoom in instead.
      spiderfyOnMaxZoom: false,
      // Nice ergonomic default: clicking a cluster zooms to fit its children.
      zoomToBoundsOnClick: true,
      showCoverageOnHover: false,
      // Slightly tighter than the default 80px so dense Manhattan clusters
      // break apart sooner as the user zooms in.
      maxClusterRadius: 60,
      iconCreateFunction: createClusterIcon,
      // Animation off — looks much cleaner with a moving fleet underneath
      // than the default cluster spawn/merge animation, which fights the RAF.
      animate: false,
      animateAddingMarkers: false,
      removeOutsideVisibleBounds: true,
      chunkedLoading: true,
    });
    group.addTo(map);
    clusterGroup.current = group;
    return () => {
      group.remove();
      clusterGroup.current = null;
    };
  }, [map]);

  // Sync feed data → entries.
  //
  // GTFS-RT note: VehiclePosition.stop_id is the *target* stop (where the
  // train is heading or stopped at), not its current location.
  //
  // Rebuilds are *minimized* to avoid visual jitter:
  //   • Marker icon DOM is only replaced when route or status actually change.
  //     Calling setIcon() on every refresh causes a wave of flicker for 350+
  //     markers as Leaflet rebuilds DOM nodes in the same tick.
  //   • Trajectories are only rebuilt when the target stop changes or the
  //     previous trajectory has expired.
  //   • When the target *does* change, we use the *previous* target stop as
  //     the new slice's origin — not the marker's interpolated visual position.
  //     This is critical: GTFS changes the target the moment the train arrives
  //     somewhere, so the previous target IS the train's true current location.
  //     Using `cur` instead would build a slice covering ~1.5 inter-station
  //     distances (the unfinished previous segment + the new segment) compressed
  //     into a single inter-station's worth of time, causing trains to fly
  //     forward at unrealistic speed and then teleport when the next arrival
  //     hits the !isMoving branch.
  //   • We also stick with the previously chosen polyline so the new slice
  //     stays on the same shape variant — prevents flipping between parallel
  //     express/local geometries.
  //
  // ── Batching note (the "5-second clear" fix) ────────────────────────────
  // Adds and removes go through `addLayers()` / `removeLayers()` (plural),
  // **never** the singular variants. Why this matters:
  //
  //   • markercluster rebuilds its spatial index on every `addLayer()` call.
  //     When the user goes Filter → Clear, ~500 new markers are added at once;
  //     calling `addLayer` per marker meant 500 spatial-index rebuilds in a
  //     tight loop and the UI froze for ~5 seconds.
  //   • `addLayers([...])` rebuilds the index once and (with our existing
  //     `chunkedLoading: true` config) splits the DOM work into idle chunks.
  //   • `chunkedLoading` ONLY applies to `addLayers`, not `addLayer`. Until
  //     this fix, the chunked-loading config was effectively dead code.
  useEffect(() => {
    const incoming = new Map(trains.map((t) => [t.id, t]));
    const nowSec = Date.now() / 1000;

    const group = clusterGroup.current;
    if (!group) return;

    // ── Pass 1: collect removals ────────────────────────────────────────
    // Modifying a Map during iteration can skip entries, so we collect IDs
    // first and mutate after.
    const toRemoveIds: string[] = [];
    const toRemoveMarkers: L.Marker[] = [];
    for (const [id, entry] of entries.current) {
      if (!incoming.has(id)) {
        toRemoveIds.push(id);
        toRemoveMarkers.push(entry.marker);
      }
    }
    if (toRemoveMarkers.length > 0) {
      // One spatial-index rebuild instead of N.
      group.removeLayers(toRemoveMarkers);
      for (const id of toRemoveIds) entries.current.delete(id);
    }

    // ── Pass 2: walk incoming, batch new markers, update existing ones ──
    const newMarkers: L.Marker[] = [];
    // Spawned movers whose trajectory we deferred (see comment below).
    // We process them on the next idle frame so the user gets an immediate
    // map and the geospatial work doesn't block the click.
    const pendingTrajectories: Array<{
      entry: TrainEntry;
      target: [number, number];
      routeId: string;
      startTime: number;
      endTime: number;
    }> = [];

    // Heuristic: when many trains spawn at once (typically Clear after a
    // filter, ~500 movers), defer the per-train turf work to idle time.
    // For small diffs (steady-state refresh) keep the synchronous path so
    // entrance animations look natural.
    const BULK_SPAWN_THRESHOLD = 50;
    let plannedNew = 0;
    for (const t of trains) if (!entries.current.has(t.id)) plannedNew++;
    const deferTrajectories = plannedNew > BULK_SPAWN_THRESHOLD;

    for (const t of trains) {
      const existing = entries.current.get(t.id);
      const isMoving =
        t.status === 'IN_TRANSIT_TO' || t.status === 'INCOMING_AT';

      // Time window for the new segment: from now until expected arrival.
      const startTime = nowSec;
      const endTime =
        t.expectedArrival && t.expectedArrival > nowSec + 5
          ? t.expectedArrival
          : nowSec + FALLBACK_SEGMENT_SECONDS;

      if (!existing) {
        // First sighting. For movers, estimate the origin by walking back
        // along the route so the train animates immediately. For stoppers,
        // just place at the platform.
        //
        // On bulk spawn (Clear after a filter), we skip the synchronous
        // estimateOrigin/buildTrajectory and instead spawn at the reported
        // position with no trajectory. The trains hold still for one tick
        // (visually fine — they're absorbed into cluster icons anyway), and
        // we backfill trajectories on the next idle frame below.
        let initialPos: [number, number] = [t.lat, t.lon];
        let trajectory: Trajectory | null = null;

        if (isMoving && routeLines && !deferTrajectories) {
          const eta = Math.max(endTime - nowSec, 30);
          const origin = estimateOrigin(
            [t.lat, t.lon],
            t.routeId,
            eta,
            routeLines,
          );
          trajectory = buildTrajectory(
            origin,
            [t.lat, t.lon],
            t.routeId,
            startTime,
            endTime,
            routeLines,
          );
          if (trajectory) initialPos = origin;
        }

        const marker = L.marker(initialPos, {
          icon: createIcon(t.routeId, t.status),
          zIndexOffset: 100,
        });
        // Stash route on the marker so the cluster-icon factory can sample
        // a route-color rim without having to look the train up by id.
        (marker as L.Marker & { _routeId?: string })._routeId = t.routeId;

        const entry: TrainEntry = { marker, data: t, trajectory };

        // Lazy popup: bindPopup accepts a function and only invokes it on
        // first open. Passing the rendered string up-front (the previous
        // approach) ran buildPopup() 600+ times on bulk spawn for popups
        // 99% of users never click. The closure reads from `entry.data`,
        // which the refresh loop keeps up to date — so we also avoid the
        // per-refresh setPopupContent() rebuild.
        marker.bindPopup(() => buildPopup(entry.data), { maxWidth: 240 });

        // Moving markers are nearly impossible to click at 60 Hz: between
        // mousedown and mouseup the icon has shifted a few pixels and
        // Leaflet's click detection misses. Freezing on hover gives the
        // user a stable target; freezing while the popup is open keeps the
        // popup tip glued to the marker while they read it.
        marker.on('mouseover', () => {
          entry.frozen = true;
        });
        marker.on('mouseout', () => {
          if (!marker.isPopupOpen()) entry.frozen = false;
        });
        marker.on('popupopen', () => {
          entry.frozen = true;
        });
        marker.on('popupclose', () => {
          entry.frozen = false;
        });

        // Buffer for batch insert below. We DON'T call group.addLayer here
        // because each call rebuilds the cluster's spatial index — death by
        // a thousand cuts when ~500 markers come in at once on Clear.
        newMarkers.push(marker);
        entries.current.set(t.id, entry);

        if (deferTrajectories && isMoving && routeLines) {
          pendingTrajectories.push({
            entry,
            target: [t.lat, t.lon],
            routeId: t.routeId,
            startTime,
            endTime,
          });
        }
        continue;
      }

      // Only rebuild the marker DOM when something visible about it changed.
      const routeOrStatusChanged =
        existing.data.routeId !== t.routeId ||
        existing.data.status !== t.status;
      if (routeOrStatusChanged) {
        existing.marker.setIcon(createIcon(t.routeId, t.status));
        (existing.marker as L.Marker & { _routeId?: string })._routeId = t.routeId;
      }
      // No setPopupContent() here — the popup is bound as a function that
      // re-reads entry.data on open, so we get fresh content for free.

      if (!isMoving) {
        // Train is stopped — clear trajectory and snap to the platform.
        existing.trajectory = null;
        existing.marker.setLatLng([t.lat, t.lon]);
        existing.data = t;
        continue;
      }

      // Moving train. Rebuild only when:
      //   (a) the target stop changed (genuine new segment), or
      //   (b) the previous trajectory has expired and the train is still in
      //       transit — feed says we should still be moving but our slice
      //       already ran out of runway, so refresh it.
      const targetChanged = existing.data.stopId !== t.stopId;
      const trajectoryExpired =
        !existing.trajectory || existing.trajectory.endTime <= nowSec;

      if (routeLines && (targetChanged || trajectoryExpired)) {
        // Origin choice — see big comment above. On targetChanged the previous
        // target stop is the train's true current position; on a pure expiry
        // (same target, slice ran out) the marker is held at the slice end,
        // which is already the snapped target, so cur and target collapse.
        const from: [number, number] = targetChanged
          ? [existing.data.lat, existing.data.lon]
          : [
              existing.marker.getLatLng().lat,
              existing.marker.getLatLng().lng,
            ];

        // Pair the visual snap with the feed update so the jump (if any) lines
        // up with the moment data refreshed, instead of being deferred to the
        // next RAF tick where it looks decoupled from anything.
        if (targetChanged) existing.marker.setLatLng(from);

        const traj = buildTrajectory(
          from,
          [t.lat, t.lon],
          t.routeId,
          startTime,
          endTime,
          routeLines,
          existing.trajectory?.sourceLine ?? null,
        );

        if (traj) {
          // Defensive max-speed clamp. If the feed's expectedArrival is
          // unrealistically tight (stale prediction, dwell-skipped data), the
          // computed speed would otherwise fly the marker across multiple
          // stops. Stretch the duration so animated speed stays plausible.
          const minDurationSec = (traj.lengthKm * 1000) / MAX_SPEED_MPS;
          if (traj.endTime - traj.startTime < minDurationSec) {
            traj.endTime = traj.startTime + minDurationSec;
          }
          existing.trajectory = traj;
        } else if (trajectoryExpired) {
          // Couldn't snap and the old slice is already done — drop on target
          // so the marker isn't frozen somewhere mid-air.
          existing.trajectory = null;
          existing.marker.setLatLng([t.lat, t.lon]);
        }
        // Otherwise: rebuild failed but old trajectory still has runway,
        // so keep animating along it.
      }

      existing.data = t;
    }

    // ── Pass 3: flush new markers in one batch ─────────────────────────
    // `addLayers` triggers a single spatial-index rebuild and uses
    // chunkedLoading internally, so the main thread breathes between chunks.
    //
    // For small batches (steady-state refresh: 0–30 newly-spawned trains per
    // 30s tick) we still get the per-marker entrance animation. For large
    // batches (Clear after a filter — hundreds of markers) we skip the
    // entrance pop, both because (a) firing 500 staggered scale-from-0
    // animations on the same frame produces a visible thrash and burns CPU
    // for no UX win, and (b) the cluster icons absorb most of these markers
    // anyway, so the entrance animation isn't even visible.
    if (newMarkers.length > 0) {
      const ANIMATE_ENTRANCE_MAX = 60;
      const animateThese = newMarkers.length <= ANIMATE_ENTRANCE_MAX;
      group.addLayers(newMarkers);
      if (animateThese) {
        // Wait one frame so leaflet has actually attached the elements.
        requestAnimationFrame(() => {
          for (const m of newMarkers) {
            const el = m.getElement();
            if (el) animateEntrance(el);
          }
        });
      }
    }

    // ── Pass 4: backfill deferred trajectories on idle ─────────────────
    // Process in chunks of ~30 per frame so we don't re-create the original
    // freeze. Anything that fails to snap stays at its reported position
    // until the next data refresh, which is fine — moving markers without a
    // trajectory just hold still, and the next refresh rebuilds them via
    // the targetChanged / trajectoryExpired path.
    if (pendingTrajectories.length > 0) {
      const queue = pendingTrajectories;
      const CHUNK = 30;
      let i = 0;
      const drain = () => {
        const end = Math.min(i + CHUNK, queue.length);
        for (; i < end; i++) {
          const job = queue[i];
          // Skip if the entry has been removed (filter changed again).
          if (!entries.current.has(job.entry.data.id)) continue;
          const eta = Math.max(job.endTime - Date.now() / 1000, 30);
          const origin = estimateOrigin(job.target, job.routeId, eta, routeLines!);
          const traj = buildTrajectory(
            origin,
            job.target,
            job.routeId,
            job.startTime,
            job.endTime,
            routeLines!,
          );
          if (traj) {
            // Defensive max-speed clamp (mirrors the synchronous path).
            const minDurationSec = (traj.lengthKm * 1000) / MAX_SPEED_MPS;
            if (traj.endTime - traj.startTime < minDurationSec) {
              traj.endTime = traj.startTime + minDurationSec;
            }
            job.entry.trajectory = traj;
            // Reposition to origin so the RAF loop animates from there.
            // Skip if the marker has no element (clustered or culled) —
            // the next visible frame will pick up the new trajectory anyway.
            if (job.entry.marker.getElement()) {
              job.entry.marker.setLatLng(origin);
            }
          }
        }
        if (i < queue.length) requestAnimationFrame(drain);
      };
      requestAnimationFrame(drain);
    }
  }, [trains, routeLines, map]);

  // Continuous RAF: every frame, recompute line-snapped positions.
  //
  // When the cluster group is collapsed (zoom < CLUSTER_DISABLE_ZOOM), every
  // setLatLng() walks the cluster index to check whether the marker moved
  // into a new cluster. At 60 Hz × ~350 markers that gets expensive, so we
  // throttle to a slower cadence — visually identical because at low zoom
  // a train moves only a few pixels per second anyway.
  //
  // We also skip markers that have no DOM element. A marker has no element when:
  //   • It's been clustered into a parent cluster icon (so the user is
  //     looking at a "12" bubble, not the individual train).
  //   • `removeOutsideVisibleBounds: true` culled it because the user
  //     panned it offscreen.
  // In both cases, calling setLatLng is pure waste — nobody can see the
  // marker, but the cluster plugin still walks its index on every move event.
  // When the marker pops back in (zoom-in or pan), the next RAF tick catches
  // it up within ~16ms (or 500ms when throttled), which is imperceptible.
  useEffect(() => {
    let lastTickAt = 0;
    function tick(now: number) {
      const clustered =
        map.getZoom() < CLUSTER_DISABLE_ZOOM;
      if (clustered && now - lastTickAt < CLUSTER_TICK_MIN_INTERVAL_MS) {
        rafId.current = requestAnimationFrame(tick);
        return;
      }
      lastTickAt = now;
      const nowSec = Date.now() / 1000;
      for (const entry of entries.current.values()) {
        if (entry.frozen) continue;
        if (!entry.marker.getElement()) continue;
        const [lat, lon] = positionAt(entry, nowSec);
        const cur = entry.marker.getLatLng();
        if (cur.lat !== lat || cur.lng !== lon) {
          entry.marker.setLatLng([lat, lon]);
        }
      }
      rafId.current = requestAnimationFrame(tick);
    }
    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, [map]);

  // Cleanup on unmount
  useEffect(() => {
    const entriesMap = entries.current;
    return () => {
      const group = clusterGroup.current;
      for (const { marker } of entriesMap.values()) {
        if (group) group.removeLayer(marker);
        else marker.remove();
      }
      entriesMap.clear();
    };
  }, []);

  return null;
}

// ── Public component ─────────────────────────────────────────────────────────
interface Props {
  trains: TrainPosition[];
  selectedRoutes: Set<string>;
  onStats: (trains: TrainPosition[]) => void;
  onLastUpdated: (d: Date) => void;
  onError: (e: string | null) => void;
  onLoading: (b: boolean) => void;
}

export default function MapComponent({
  trains: allTrains,
  selectedRoutes,
  onStats,
  onLastUpdated,
  onError,
  onLoading,
}: Props) {
  const [routeLines, setRouteLines] = useState<RouteLines | null>(null);

  const fetchTrains = useCallback(async () => {
    try {
      const res = await fetch('/api/trains', { cache: 'no-store' });
      const data: TrainsApiResponse = await res.json();
      if (data.error) { onError(data.error); onLoading(false); return; }
      onStats(data.trains);
      onLastUpdated(new Date(data.lastUpdated));
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Network error');
    } finally {
      onLoading(false);
    }
  }, [onError, onLoading, onStats, onLastUpdated]);

  useEffect(() => {
    fetchTrains();
    const id = setInterval(fetchTrains, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [fetchTrains]);

  const visible =
    selectedRoutes.size === 0
      ? allTrains
      : allTrains.filter((t) => selectedRoutes.has(t.routeId));

  const handleShapesLoaded = useCallback((lines: RouteLines) => {
    setRouteLines(lines);
  }, []);

  // Subscribe to theme so the basemap follows the toggle. When `tileUrl`
  // changes, react-leaflet propagates it to the underlying L.tileLayer via
  // setUrl(), which fades from old tiles to new ones — no remount needed.
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getResolvedTheme,
    getResolvedThemeServerSnapshot,
  );
  const tileUrl =
    theme === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  return (
    <MapContainer
      center={NYC_CENTER}
      zoom={12}
      minZoom={NYC_MIN_ZOOM}
      maxBounds={NYC_BOUNDS}
      maxBoundsViscosity={1.0}
      className="w-full h-full"
      zoomControl={false}
    >
      <ZoomControls />
      {/*
        No `key={theme}` here on purpose. Keying forces a full unmount/remount,
        which destroys every visible tile DOM node and shows a blank frame
        before new tiles paint in. Letting react-leaflet propagate the `url`
        prop change calls `setUrl()` under the hood, which fades from old to
        new tiles smoothly via Leaflet's built-in opacity transition.
      */}
      <TileLayer
        url={tileUrl}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        subdomains="abcd"
        maxZoom={20}
      />
      <StationsLayer />
      <SubwayLinesLayer
        selectedRoutes={selectedRoutes}
        onShapesLoaded={handleShapesLoaded}
      />
      <AnimatedTrainLayer trains={visible} routeLines={routeLines} />
      <Station3DMarkersLayer />
    </MapContainer>
  );
}
