import { NextResponse } from 'next/server';
import { getStops, resolveStop } from '@/lib/gtfs-static';
import type { TrainPosition, TrainsApiResponse } from '@/lib/types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

const MTA_FEEDS = [
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',       // 1,2,3,4,5,6,7,S
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',   // A,C,E,H
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm',  // B,D,F,M,FS
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g',     // G
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz',    // J,Z
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw',  // N,Q,R,W
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l',     // L
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si',    // SIR
];

// currentStatus comes back as either the string name or numeric index
const STATUS_MAP: Record<string | number, TrainPosition['status']> = {
  INCOMING_AT: 'INCOMING_AT',
  STOPPED_AT: 'STOPPED_AT',
  IN_TRANSIT_TO: 'IN_TRANSIT_TO',
  0: 'INCOMING_AT',
  1: 'STOPPED_AT',
  2: 'IN_TRANSIT_TO',
};

async function fetchFeed(url: string) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const buf = await res.arrayBuffer();
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buf));
}

// Long / string / number → plain JS number
function toLong(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseInt(v, 10) || 0;
  // protobufjs Long object
  if (typeof v === 'object' && v !== null && 'low' in v) return Number((v as { low: number }).low);
  return 0;
}

export async function GET() {
  try {
    const stops = await getStops();
    const results = await Promise.allSettled(MTA_FEEDS.map(fetchFeed));

    const trains: TrainPosition[] = [];
    const seen = new Set<string>();

    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('Feed failed:', result.reason);
        continue;
      }

      const feed = result.value;

      // ── Pass 1: from TripUpdate, capture per-trip metadata —
      //           expected arrival at the *next* stop (first stopTimeUpdate)
      //           and the trip headsign (resolved name of the *terminal*
      //           stop, which is the last stopTimeUpdate). ─────────────────
      const tripExpectedArrival = new Map<string, number>();
      const tripHeadsign = new Map<string, string>();

      for (const entity of feed.entity) {
        const tu = entity.tripUpdate;
        if (!tu) continue;

        const tripId: string = tu.trip?.tripId ?? '';
        const updates: unknown[] = tu.stopTimeUpdate ?? [];
        if (!tripId || updates.length === 0) continue;

        const first = updates[0] as Record<string, unknown>;
        const arrival = first.arrival as Record<string, unknown> | undefined;
        const departure = first.departure as Record<string, unknown> | undefined;
        const expectedArrival =
          toLong(arrival?.time) || toLong(departure?.time) || 0;
        if (expectedArrival > 0) tripExpectedArrival.set(tripId, expectedArrival);

        // The terminal stop's name is the rider-facing destination — exactly
        // what MTA shows on platform countdowns and front-of-train roll signs
        // ("To Wakefield-241 St"). MTA's GTFS-RT feed doesn't populate the
        // `Trip.headsign` extension, so we derive it from the last scheduled
        // stop in this trip's update.
        const last = updates[updates.length - 1] as Record<string, unknown>;
        const lastStopId = (last.stopId as string | undefined) ?? '';
        if (lastStopId) {
          const lastStop = resolveStop(lastStopId, stops);
          if (lastStop?.name) tripHeadsign.set(tripId, lastStop.name);
        }
      }

      // ── Pass 2: collect VehiclePosition entities ──────────────────────────
      for (const entity of feed.entity) {
        const v = entity.vehicle;
        if (!v) continue;

        const routeId: string = (v.trip?.routeId ?? '').toUpperCase();
        const tripId: string = v.trip?.tripId ?? '';
        const stopId: string = v.stopId ?? '';

        // Stable client ID across feed refreshes.
        //
        // GTFS-RT `entity.id` is a per-FeedMessage sequence (e.g. "000001"),
        // NOT a persistent train identifier. Using it as the marker key meant
        // every 30s every train got a "new" id, causing the client to delete
        // the old marker and re-create it via the first-sighting path —
        // which calls estimateOrigin() and rubber-bands the train backward
        // along the route. That's the visible "reset on refresh".
        //
        // tripId is stable for the lifetime of the trip; route+trip is unique
        // across the system. Fall back to entity.id only if tripId is missing.
        const entityId: string = tripId
          ? `${routeId}-${tripId}`
          : (entity.id ?? `${routeId}-${stopId}`);

        if (!routeId || seen.has(entityId)) continue;
        seen.add(entityId);

        const stop = resolveStop(stopId, stops);
        if (!stop) continue;

        const status = STATUS_MAP[v.currentStatus as string | number] ?? 'UNKNOWN';
        const ts = toLong(v.timestamp) || Math.floor(Date.now() / 1000);
        const expectedArrival = tripExpectedArrival.get(tripId);
        const headsign = tripHeadsign.get(tripId);

        // MTA convention: stopId ends with 'N' for northbound (uptown / Bronx /
        // Queens-bound) or 'S' for southbound (downtown / Brooklyn-bound).
        const dirSuffix = stopId.slice(-1).toUpperCase();
        const direction = dirSuffix === 'N' || dirSuffix === 'S' ? dirSuffix : undefined;

        trains.push({
          id: entityId,
          routeId,
          tripId,
          stopId,
          stopName: stop.name,
          lat: stop.lat,
          lon: stop.lon,
          status: status as TrainPosition['status'],
          timestamp: ts,
          expectedArrival,
          direction,
          headsign,
        });
      }
    }

    const body: TrainsApiResponse = {
      trains,
      lastUpdated: Date.now(),
      count: trains.length,
    };

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    const body: TrainsApiResponse = {
      trains: [],
      lastUpdated: Date.now(),
      count: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    return NextResponse.json(body, { status: 500 });
  }
}
