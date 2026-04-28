"use client";

import { useMemo } from "react";
import type { PlatformFeature, LatLon } from "@/lib/station3d/types";
import { projectCentroid } from "@/lib/station3d/projection";

// Warm tungsten ~2700K. Real station fluorescents are colder, but warm
// pools read better against the cool blue of fog/sky in the scene.
const LAMP_COLOR = "#ffd6a5";

// Lift the lamp 3 m above the slab top — high enough that platform users
// (the train markers) sit firmly inside the cone of light, low enough that
// the falloff stays local to the platform and doesn't bloom into adjacent
// tracks.
const LAMP_LIFT_M = 3;
const LAMP_INTENSITY = 7;
const LAMP_DISTANCE_M = 22;
const LAMP_DECAY = 2;

/**
 * Lights one warm point light per platform, anchored above the platform's
 * AABB centroid. The lights have no shadow casters (cost-prohibitive at 8
 * platforms × 1024² shadow maps) and are intentionally short-range so they
 * read as station-ceiling fixtures rather than as a single floodlight.
 *
 * Visual purpose: counteracts the uniform cool fog from the directional
 * light, which made all platforms look identically lit. Each platform now
 * has its own warm pool of light, which sells the "this is an underground
 * station" feel.
 */
export function PlatformLights({
  platforms,
  origin,
}: {
  platforms: PlatformFeature[];
  origin: LatLon;
}) {
  const lamps = useMemo(
    () =>
      platforms.map((p) => {
        const c = projectCentroid(p.polyline, origin);
        return {
          id: p.id,
          position: [c.x, p.depthM + LAMP_LIFT_M, c.z] as [
            number,
            number,
            number,
          ],
        };
      }),
    [platforms, origin],
  );

  return (
    <group>
      {lamps.map((lamp) => (
        <pointLight
          key={lamp.id}
          position={lamp.position}
          color={LAMP_COLOR}
          intensity={LAMP_INTENSITY}
          distance={LAMP_DISTANCE_M}
          decay={LAMP_DECAY}
        />
      ))}
    </group>
  );
}
