export interface Stop {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
  locationType: number;
  parentStation: string;
}

/**
 * Lightweight station shape served to the client.
 *
 * One per MTA "parent station" (locationType=1) — collapses the N/S platforms
 * into a single rendered dot, since geographically they're at the same place.
 */
export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface TrainPosition {
  id: string;
  routeId: string;
  tripId: string;
  stopId: string;
  stopName: string;
  lat: number;
  lon: number;
  status: 'STOPPED_AT' | 'IN_TRANSIT_TO' | 'INCOMING_AT' | 'UNKNOWN';
  timestamp: number;
  /** Epoch seconds — expected arrival at the current target stop (from TripUpdate) */
  expectedArrival?: number;
  /** GTFS direction suffix (N or S) extracted from stopId. Cardinal, not rider-facing. */
  direction?: string;
  /**
   * Trip terminal stop name (e.g. "Wakefield-241 St"). Pulled from the last
   * entry of TripUpdate.stopTimeUpdate. Preferred over `direction` for
   * rider-facing labels — matches MTA's "To {destination}" convention.
   */
  headsign?: string;
}

export interface TrainsApiResponse {
  trains: TrainPosition[];
  lastUpdated: number;
  count: number;
  error?: string;
}

export interface RouteStats {
  routeId: string;
  count: number;
  color: string;
}
