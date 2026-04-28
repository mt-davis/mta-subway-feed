"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { TrackFeature, LatLon } from "@/lib/station3d/types";
import { project } from "@/lib/station3d/projection";

const TRACK_RADIUS = 0.25; // meters

// Tinted by level so the eye can distinguish stacked tunnels.
const TRACK_COLOR_BY_LEVEL: Record<string, string> = {
  "-1": "#fbbf24", // BMT Broadway (N/Q/R/W) — yellow-ish
  "-2": "#34d399", // IRT Lex (4/5/6) — green-ish
  "-3": "#cbd5e1", // BMT Canarsie (L) — light gray
};
const TRACK_FALLBACK_COLOR = "#64748b";

export function Tracks({
  tracks,
  origin,
}: {
  tracks: TrackFeature[];
  origin: LatLon;
}) {
  return (
    <group>
      {tracks.map((t) => (
        <TrackTube key={t.id} track={t} origin={origin} />
      ))}
    </group>
  );
}

function TrackTube({
  track,
  origin,
}: {
  track: TrackFeature;
  origin: LatLon;
}) {
  const geometry = useMemo(() => {
    if (track.polyline.length < 2) return null;
    const points = track.polyline.map((ll) => {
      const { x, z } = project(ll, origin);
      return new THREE.Vector3(x, track.depthM, z);
    });
    // Drop consecutive duplicates — CatmullRomCurve3 fails on zero-length segments.
    const deduped: THREE.Vector3[] = [];
    for (const p of points) {
      const last = deduped[deduped.length - 1];
      if (!last || last.distanceTo(p) > 0.001) deduped.push(p);
    }
    if (deduped.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(deduped, false, "centripetal", 0.5);
    const tubularSegments = Math.max(deduped.length * 4, 16);
    return new THREE.TubeGeometry(
      curve,
      tubularSegments,
      TRACK_RADIUS,
      6,
      false
    );
  }, [track, origin]);

  if (!geometry) return null;
  const color =
    TRACK_COLOR_BY_LEVEL[String(track.level)] ?? TRACK_FALLBACK_COLOR;

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={color}
        metalness={0.4}
        roughness={0.55}
        emissive={color}
        emissiveIntensity={0.05}
      />
    </mesh>
  );
}
