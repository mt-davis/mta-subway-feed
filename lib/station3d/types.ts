/**
 * Shared types for the 3D station model.
 * The slim, derived JSON shipped under public/stations/<id>.station3d.json
 * matches the StationModel shape below.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface BBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export type SubwayLine = "lex" | "broadway" | "canarsie" | string;

export interface PlatformFeature {
  /** Stable OSM-derived id, e.g. "way/509025007". */
  id: string;
  /** Ordinal OSM level. Negative = below ground. */
  level: number;
  /** Approximate physical depth in meters (negative below ground). */
  depthM: number;
  /** Optional logical line grouping, e.g. "lex" / "broadway" / "canarsie". */
  line?: SubwayLine;
  /** Routes that use this platform, e.g. ["4","5","6"]. */
  routes?: string[];
  /** Display name from OSM, if present. */
  name?: string;
  polyline: LatLon[];
}

export interface TrackFeature {
  id: string;
  level: number;
  depthM: number;
  tunnel: boolean;
  polyline: LatLon[];
}

export interface StairsFeature {
  id: string;
  /** Higher of the two connected levels (e.g. 0). */
  fromLevel: number;
  /** Lower of the two connected levels (e.g. -2). */
  toLevel: number;
  fromDepthM: number;
  toDepthM: number;
  polyline: LatLon[];
}

export interface ElevatorFeature {
  id: string;
  /** All levels the elevator touches, sorted from highest to lowest. */
  levels: number[];
  position: LatLon;
}

export interface EntranceFeature {
  id: string;
  position: LatLon;
  wheelchair?: "yes" | "no" | "limited" | "designated";
  ref?: string;
}

export interface StationModel {
  /** Slug, e.g. "union-square". */
  id: string;
  name: string;
  /** Geographic origin used as the local-meters reference. */
  center: LatLon;
  bbox: BBox;
  /** Ordinal OSM level (as string key) → meters of depth. 0 = street. */
  levelToDepthM: Record<string, number>;
  platforms: PlatformFeature[];
  tracks: TrackFeature[];
  stairs: StairsFeature[];
  elevators: ElevatorFeature[];
  entrances: EntranceFeature[];
  /** Raw OSM ids that we couldn't classify, for diagnostics. */
  unclassifiedCount: number;
  /** When the slim model was generated, ISO. */
  generatedAt: string;
}
