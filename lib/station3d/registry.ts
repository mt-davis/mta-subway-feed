import type { LatLon } from "./types";

/**
 * Stations that have a built-out 3D model under public/stations/<id>.station3d.json.
 * The 2D map renders a special "3D" marker for each entry; clicking it opens
 * the 3D scene at /station/<id>/3d.
 */
export interface Station3DEntry {
  id: string;
  name: string;
  shortName: string;
  position: LatLon;
}

export const STATIONS_WITH_3D: Station3DEntry[] = [
  {
    id: "union-square",
    name: "14th St–Union Square",
    shortName: "Union Sq",
    position: { lat: 40.734673, lon: -73.989951 },
  },
];
