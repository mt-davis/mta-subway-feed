"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { PlatformFeature, LatLon } from "@/lib/station3d/types";
import { project, projectCentroid } from "@/lib/station3d/projection";
import { LINE_COLOR, PLATFORM_FALLBACK_COLOR } from "@/lib/station3d/colors";

const SLAB_THICKNESS = 0.4;

export function PlatformSlabs({
  platforms,
  origin,
}: {
  platforms: PlatformFeature[];
  origin: LatLon;
}) {
  return (
    <group>
      {platforms.map((p) => (
        <PlatformSlab key={p.id} platform={p} origin={origin} />
      ))}
    </group>
  );
}

function PlatformSlab({
  platform,
  origin,
}: {
  platform: PlatformFeature;
  origin: LatLon;
}) {
  const { geometry, fallbackBox, color } = useMemo(() => {
    const c = LINE_COLOR[platform.line ?? ""] ?? PLATFORM_FALLBACK_COLOR;

    // Build a closed 2D polygon in shape-space from the projected polyline.
    // We negate z because the extrude+rotate combo flips that axis.
    const pts: THREE.Vector2[] = [];
    for (const ll of platform.polyline) {
      const { x, z } = project(ll, origin);
      pts.push(new THREE.Vector2(x, -z));
    }
    if (pts.length >= 2 && pts[0].distanceTo(pts[pts.length - 1]) > 0.01) {
      pts.push(pts[0].clone());
    }

    if (pts.length < 4) {
      return { geometry: null, fallbackBox: null, color: c };
    }

    try {
      const shape = new THREE.Shape(pts);
      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: SLAB_THICKNESS,
        bevelEnabled: false,
      });
      // Lay flat: shape lives in XY, rotate so it's on XZ.
      geom.rotateX(-Math.PI / 2);
      // Move geometry so its top sits at y=0 locally (we then place the mesh
      // at y = platform.depthM).
      geom.translate(0, -SLAB_THICKNESS, 0);
      // Re-center to origin so we can position via mesh.position.
      return { geometry: geom, fallbackBox: null, color: c };
    } catch {
      // Bad polygon (self-intersecting, etc.) → AABB fallback.
      const projected = platform.polyline.map((p) => project(p, origin));
      const xs = projected.map((p) => p.x);
      const zs = projected.map((p) => p.z);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      return {
        geometry: null,
        fallbackBox: {
          x: (minX + maxX) / 2,
          z: (minZ + maxZ) / 2,
          width: Math.max(maxX - minX, 1),
          depth: Math.max(maxZ - minZ, 1),
        },
        color: c,
      };
    }
  }, [platform, origin]);

  if (geometry) {
    return (
      <mesh
        geometry={geometry}
        position={[0, platform.depthM, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={color} metalness={0.05} roughness={0.7} />
      </mesh>
    );
  }

  if (fallbackBox) {
    return (
      <mesh
        position={[
          fallbackBox.x,
          platform.depthM - SLAB_THICKNESS / 2,
          fallbackBox.z,
        ]}
        castShadow
        receiveShadow
      >
        <boxGeometry
          args={[fallbackBox.width, SLAB_THICKNESS, fallbackBox.depth]}
        />
        <meshStandardMaterial color={color} metalness={0.05} roughness={0.7} />
      </mesh>
    );
  }

  return null;
}

// Re-export so callers can use it without an extra import.
export { projectCentroid };
