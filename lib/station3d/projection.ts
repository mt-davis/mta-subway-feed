import type { LatLon } from "./types";

/**
 * Approximate flat-earth projection from lat/lon to local meters around a
 * fixed origin. Valid for ranges of ~1 km. Output:
 *   x = east meters (positive if east of origin)
 *   z = south meters (positive if south of origin) — chosen so that, in a
 *       three.js scene with the camera looking along -y, north appears "up"
 *       on screen when -z faces the viewer.
 */
const METERS_PER_DEG_LAT = 111_320;

export function project(point: LatLon, origin: LatLon): { x: number; z: number } {
  const latRad = (origin.lat * Math.PI) / 180;
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(latRad);
  const x = (point.lon - origin.lon) * metersPerDegLon;
  const z = -(point.lat - origin.lat) * METERS_PER_DEG_LAT;
  return { x, z };
}

/** Project an array of lat/lon points and return their AABB centroid. */
export function projectCentroid(
  points: LatLon[],
  origin: LatLon
): { x: number; z: number } {
  if (points.length === 0) return { x: 0, z: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    const { x, z } = project(p, origin);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
}
