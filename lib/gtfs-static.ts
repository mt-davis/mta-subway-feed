import JSZip from 'jszip';
import type { Stop } from './types';
import { getRouteColor } from './route-colors';

const CACHE_TTL = 3_600_000; // 1 hour
const GTFS_STATIC_URL = 'https://rrgtfsrt.mta.info/gtfs_static/nyct%2Fsubway.zip';
const GTFS_STATIC_FALLBACK = 'http://web.mta.info/developers/data/nyct/subway/google_transit.zip';

// ── Shared zip cache (stops + shapes share one download) ─────────────────────
let zipCache: { zip: JSZip; time: number } | null = null;

async function getGtfsZip(): Promise<JSZip | null> {
  if (zipCache && Date.now() - zipCache.time < CACHE_TTL) return zipCache.zip;

  for (const url of [GTFS_STATIC_URL, GTFS_STATIC_FALLBACK]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      zipCache = { zip, time: Date.now() };
      console.log('GTFS static zip loaded');
      return zip;
    } catch (err) {
      console.warn(`GTFS static fetch failed (${url}):`, err);
    }
  }
  return null;
}

// ── Stops ────────────────────────────────────────────────────────────────────
let stopsCache: Map<string, Stop> | null = null;
let stopsCacheTime = 0;

export async function getStops(): Promise<Map<string, Stop>> {
  if (stopsCache && Date.now() - stopsCacheTime < CACHE_TTL) return stopsCache;

  const zip = await getGtfsZip();
  if (zip) {
    const file = zip.file('stops.txt');
    if (file) {
      const text = await file.async('text');
      stopsCache = parseStopsTxt(text);
      stopsCacheTime = Date.now();
      console.log(`Loaded ${stopsCache.size} stops`);
      return stopsCache;
    }
  }

  console.warn('Using embedded fallback stops');
  stopsCache = getFallbackStops();
  stopsCacheTime = Date.now();
  return stopsCache;
}

/**
 * Returns the parent-station rows from stops.txt (locationType=1).
 *
 * MTA splits each station into three stops.txt rows: a parent station
 * (locationType=1) plus N/S platform children (locationType=0). For map
 * rendering we want one dot per physical station — uptown and downtown
 * platforms are at the same place — so we return only the parents.
 */
export async function getStations(): Promise<Stop[]> {
  const stops = await getStops();
  const stations: Stop[] = [];
  for (const stop of stops.values()) {
    if (stop.locationType === 1) stations.push(stop);
  }
  return stations;
}

// ── Shapes ───────────────────────────────────────────────────────────────────
export interface RouteGeoFeature {
  type: 'Feature';
  properties: { routeId: string; color: string };
  geometry: { type: 'MultiLineString'; coordinates: [number, number][][] };
}

let shapesCache: RouteGeoFeature[] | null = null;
let shapesCacheTime = 0;

/**
 * Returns one GeoJSON Feature (MultiLineString) per route.
 * Coordinates are [lon, lat] per the GeoJSON spec.
 */
export async function getShapes(): Promise<RouteGeoFeature[]> {
  if (shapesCache && Date.now() - shapesCacheTime < CACHE_TTL) return shapesCache;

  const zip = await getGtfsZip();
  if (!zip) return [];

  const [tripsFile, shapesFile] = [zip.file('trips.txt'), zip.file('shapes.txt')];
  if (!tripsFile || !shapesFile) return [];

  const [tripsTxt, shapesTxt] = await Promise.all([
    tripsFile.async('text'),
    shapesFile.async('text'),
  ]);

  // ── Parse trips.txt → route_id → Set<shape_id> ──────────────────────────
  const routeShapeMap = parseTrips(tripsTxt);

  // ── Parse shapes.txt → shape_id → [lon, lat][] ──────────────────────────
  const shapePoints = parseShapes(shapesTxt);

  // ── Build one MultiLineString feature per route ──────────────────────────
  const features: RouteGeoFeature[] = [];

  for (const [routeId, shapeIds] of routeShapeMap) {
    const lines: [number, number][][] = [];

    for (const shapeId of shapeIds) {
      const pts = shapePoints.get(shapeId);
      if (pts && pts.length >= 2) lines.push(pts);
    }

    if (lines.length === 0) continue;

    features.push({
      type: 'Feature',
      properties: { routeId, color: getRouteColor(routeId) },
      geometry: { type: 'MultiLineString', coordinates: lines },
    });
  }

  shapesCache = features;
  shapesCacheTime = Date.now();
  console.log(`Built ${features.length} route shape features`);
  return features;
}

// ── Parsers ──────────────────────────────────────────────────────────────────
function parseTrips(text: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const lines = text.replace(/\r/g, '').trim().split('\n');
  if (lines.length < 2) return map;

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const riIdx = header.indexOf('route_id');
  const siIdx = header.indexOf('shape_id');
  if (riIdx < 0 || siIdx < 0) return map;

  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split(',');
    const routeId = fields[riIdx]?.trim().toUpperCase();
    const shapeId = fields[siIdx]?.trim();
    if (!routeId || !shapeId) continue;

    const set = map.get(routeId) ?? new Set<string>();
    set.add(shapeId);
    map.set(routeId, set);
  }
  return map;
}

function parseShapes(text: string): Map<string, [number, number][]> {
  const map = new Map<string, [number, number][]>();
  const lines = text.replace(/\r/g, '').trim().split('\n');
  if (lines.length < 2) return map;

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idIdx  = header.indexOf('shape_id');
  const latIdx = header.indexOf('shape_pt_lat');
  const lonIdx = header.indexOf('shape_pt_lon');
  const seqIdx = header.indexOf('shape_pt_sequence');
  if (idIdx < 0 || latIdx < 0 || lonIdx < 0) return map;

  // Collect raw points
  const raw = new Map<string, Array<{ seq: number; lon: number; lat: number }>>();

  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split(',');
    const shapeId = fields[idIdx]?.trim();
    const lat = parseFloat(fields[latIdx]?.trim() ?? '');
    const lon = parseFloat(fields[lonIdx]?.trim() ?? '');
    const seq = seqIdx >= 0 ? parseInt(fields[seqIdx]?.trim() ?? '0', 10) : i;
    if (!shapeId || isNaN(lat) || isNaN(lon)) continue;

    const arr = raw.get(shapeId) ?? [];
    arr.push({ seq, lat, lon });
    raw.set(shapeId, arr);
  }

  // Sort by sequence, decimate for smaller payload, convert to [lon, lat]
  for (const [shapeId, pts] of raw) {
    pts.sort((a, b) => a.seq - b.seq);

    const decimated: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      // Keep every 4th interior point; always keep first and last
      if (i === 0 || i === pts.length - 1 || i % 4 === 0) {
        // Round to 5 decimal places (~1m accuracy)
        decimated.push([
          Math.round(pts[i].lon * 1e5) / 1e5,
          Math.round(pts[i].lat * 1e5) / 1e5,
        ]);
      }
    }
    if (decimated.length >= 2) map.set(shapeId, decimated);
  }

  return map;
}

// ── Stop parsing helpers ─────────────────────────────────────────────────────
function parseStopsTxt(text: string): Map<string, Stop> {
  const map = new Map<string, Stop>();
  const lines = text.replace(/\r/g, '').trim().split('\n');
  if (lines.length < 2) return map;

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = {
    stopId: header.indexOf('stop_id'),
    name: header.indexOf('stop_name'),
    lat: header.indexOf('stop_lat'),
    lon: header.indexOf('stop_lon'),
    locationType: header.indexOf('location_type'),
    parentStation: header.indexOf('parent_station'),
  };

  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);
    if (fields.length < 4) continue;
    const stopId = fields[idx.stopId]?.trim();
    const name = fields[idx.name]?.trim() ?? '';
    const lat = parseFloat(fields[idx.lat]?.trim() ?? '0');
    const lon = parseFloat(fields[idx.lon]?.trim() ?? '0');
    const locationType = parseInt(fields[idx.locationType]?.trim() ?? '0', 10);
    const parentStation = fields[idx.parentStation]?.trim() ?? '';
    if (stopId && !isNaN(lat) && !isNaN(lon) && (lat !== 0 || lon !== 0)) {
      map.set(stopId, { stopId, name, lat, lon, locationType, parentStation });
    }
  }
  return map;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { fields.push(current); current = ''; }
    else current += ch;
  }
  fields.push(current);
  return fields;
}

export function resolveStop(stopId: string, stops: Map<string, Stop>): Stop | undefined {
  let stop = stops.get(stopId);
  if (stop) return stop;
  const base = stopId.replace(/[NSEW]$/, '');
  stop = stops.get(base);
  if (stop) return stop;
  const numericOnly = stopId.replace(/[^0-9]/g, '');
  if (numericOnly) { stop = stops.get(numericOnly); if (stop) return stop; }
  return undefined;
}

// ── Embedded fallback stops ──────────────────────────────────────────────────
function getFallbackStops(): Map<string, Stop> {
  const raw: Array<[string, string, number, number]> = [
    ['101','Van Cortlandt Park-242 St',40.889248,-73.898583],
    ['103','Dyckman St',40.860531,-73.927328],
    ['104','207 St',40.864614,-73.918822],
    ['106','125 St',40.815581,-73.955822],
    ['107','116 St',40.807823,-73.960697],
    ['108','110 St',40.803967,-73.964718],
    ['109','103 St',40.799446,-73.968525],
    ['110','96 St',40.793919,-73.972323],
    ['111','86 St',40.789600,-73.976218],
    ['112','79 St',40.783934,-73.979875],
    ['113','72 St',40.778453,-73.981970],
    ['114','66 St-Lincoln Center',40.773209,-73.982050],
    ['115','59 St-Columbus Circle',40.768247,-73.981931],
    ['116','50 St',40.761728,-73.983849],
    ['117','Times Sq-42 St',40.755477,-73.987691],
    ['118','34 St-Penn Station',40.750373,-73.999656],
    ['119','28 St',40.749567,-73.997850],
    ['120','23 St',40.745906,-73.998041],
    ['121','18 St',40.743328,-74.001736],
    ['122','14 St',40.737826,-74.000201],
    ['123','Christopher St',40.733422,-74.007080],
    ['124','Houston St',40.728553,-74.005823],
    ['125','Canal St',40.718092,-74.003744],
    ['126','Chambers St',40.715478,-74.009168],
    ['127','Fulton St',40.710374,-74.007582],
    ['128','Cortlandt St',40.711835,-74.012188],
    ['129','Rector St',40.707557,-74.013634],
    ['130','South Ferry',40.702068,-74.013664],
    ['401','Woodlawn',40.886037,-73.878751],
    ['418','Lexington Ave/59 St',40.762908,-73.967258],
    ['420','Grand Central-42 St',40.751776,-73.976848],
    ['424','14 St-Union Sq',40.734673,-73.989951],
    ['429','Brooklyn Bridge-City Hall',40.713065,-74.004131],
    ['433','Borough Hall',40.692404,-73.990151],
    ['445','Flatbush Ave-Brooklyn College',40.632836,-73.947642],
    ['A02','Inwood-207 St',40.868072,-73.919899],
    ['A24','59 St-Columbus Circle',40.768247,-73.981931],
    ['A27','42 St-Port Authority',40.757308,-73.989735],
    ['A31','W 4 St-Wash Sq',40.732338,-74.000495],
    ['A36','Fulton St',40.709416,-74.010628],
    ['A38','Howard Beach-JFK Airport',40.660476,-73.830301],
    ['A57','Far Rockaway-Mott Ave',40.603995,-73.755405],
    ['A59','Rockaway Park-Beach 116 St',40.580638,-73.835592],
    ['R01','Forest Hills-71 Ave',40.721691,-73.844521],
    ['R35','Bay Ridge-95 St',40.616622,-74.030876],
    ['Q01','Astoria-Ditmars Blvd',40.775036,-73.912034],
    ['Q25','Coney Island-Stillwell Ave',40.577422,-73.981233],
    ['L01','Canarsie-Rockaway Pkwy',40.646388,-73.901704],
    ['L29','Broadway Junction',40.678334,-73.905316],
    ['G05','Court Sq',40.747023,-73.945264],
    ['G22','Church Ave',40.650842,-73.979680],
    ['J12','Jamaica Center-Parsons/Archer',40.702566,-73.816859],
    ['J45','Broad St',40.706476,-74.010893],
    ['701','Flushing-Main St',40.759600,-73.830301],
    ['719','Times Sq-42 St',40.755477,-73.987691],
    ['D01','Norwood-205 St',40.874614,-73.878193],
    ['D31','Coney Island-Stillwell Ave',40.577422,-73.981233],
    ['S01','St George',40.644843,-74.073643],
    ['S22','Tottenville',40.512764,-74.228826],
  ];

  const map = new Map<string, Stop>();
  for (const [stopId, name, lat, lon] of raw) {
    const stop: Stop = { stopId, name, lat, lon, locationType: 0, parentStation: '' };
    map.set(stopId, stop);
    map.set(stopId + 'N', { ...stop, stopId: stopId + 'N' });
    map.set(stopId + 'S', { ...stop, stopId: stopId + 'S' });
  }
  return map;
}
