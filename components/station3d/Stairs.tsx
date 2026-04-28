"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import type { StairsFeature, LatLon } from "@/lib/station3d/types";
import { project } from "@/lib/station3d/projection";

const STAIR_COLOR = "#f59e0b"; // amber 500
const STAIR_LINE_WIDTH = 2;

export function Stairs({
  stairs,
  origin,
}: {
  stairs: StairsFeature[];
  origin: LatLon;
}) {
  return (
    <group>
      {stairs.map((s) => (
        <StairRibbon key={s.id} stair={s} origin={origin} />
      ))}
    </group>
  );
}

function StairRibbon({
  stair,
  origin,
}: {
  stair: StairsFeature;
  origin: LatLon;
}) {
  const points = useMemo(() => {
    const planar = stair.polyline.map((ll) => project(ll, origin));
    if (planar.length < 2) return null;

    // Compute cumulative horizontal distance so we can ramp Y along arc length.
    const distances: number[] = [0];
    for (let i = 1; i < planar.length; i++) {
      const dx = planar[i].x - planar[i - 1].x;
      const dz = planar[i].z - planar[i - 1].z;
      distances.push(distances[i - 1] + Math.hypot(dx, dz));
    }
    const total = distances[distances.length - 1];
    if (total < 0.5) return null; // skip degenerate stairs

    const out: THREE.Vector3[] = [];
    for (let i = 0; i < planar.length; i++) {
      const t = total > 0 ? distances[i] / total : 0;
      const y = stair.fromDepthM + (stair.toDepthM - stair.fromDepthM) * t;
      out.push(new THREE.Vector3(planar[i].x, y, planar[i].z));
    }
    return out;
  }, [stair, origin]);

  if (!points) return null;
  return (
    <Line
      points={points}
      color={STAIR_COLOR}
      lineWidth={STAIR_LINE_WIDTH}
      transparent
      opacity={0.85}
    />
  );
}
