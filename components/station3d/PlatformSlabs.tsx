"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { PlatformFeature, LatLon } from "@/lib/station3d/types";
import { project, projectCentroid } from "@/lib/station3d/projection";
import { LINE_COLOR, PLATFORM_FALLBACK_COLOR } from "@/lib/station3d/colors";

const SLAB_THICKNESS = 0.4;

// MTA tactile-warning strip color. Universal yellow regardless of line —
// it's a safety paint, not a line identifier.
const SAFETY_STRIPE_COLOR = "#facc15";
const SAFETY_STRIPE_RADIUS = 0.06;
const SAFETY_STRIPE_LIFT = 0.01; // float just above the slab top

// Mute the line color toward slate before painting the slab. Pure-saturation
// LINE_COLOR reads as plastic; mixing 40% toward neutral gray lands somewhere
// between "painted concrete" and "tinted floor", which is what real
// platforms actually look like.
const NEUTRAL_GRAY = new THREE.Color("#475569");
const SLAB_DESATURATION = 0.4;

function muteLineColor(hex: string): string {
  const c = new THREE.Color(hex);
  c.lerp(NEUTRAL_GRAY, SLAB_DESATURATION);
  return "#" + c.getHexString();
}

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

interface BuiltPlatform {
  slab: THREE.BufferGeometry | null;
  fallbackBox: { x: number; z: number; width: number; depth: number } | null;
  safetyStripe: THREE.TubeGeometry | null;
  color: string;
}

function PlatformSlab({
  platform,
  origin,
}: {
  platform: PlatformFeature;
  origin: LatLon;
}) {
  const built = useMemo<BuiltPlatform>(
    () => buildPlatform(platform, origin),
    [platform, origin],
  );

  const slabMaterial = (
    <meshStandardMaterial
      color={built.color}
      metalness={0.02}
      roughness={0.92}
    />
  );

  return (
    <group>
      {built.slab && (
        <mesh
          geometry={built.slab}
          position={[0, platform.depthM, 0]}
          castShadow
          receiveShadow
        >
          {slabMaterial}
        </mesh>
      )}
      {built.fallbackBox && (
        <mesh
          position={[
            built.fallbackBox.x,
            platform.depthM - SLAB_THICKNESS / 2,
            built.fallbackBox.z,
          ]}
          castShadow
          receiveShadow
        >
          <boxGeometry
            args={[
              built.fallbackBox.width,
              SLAB_THICKNESS,
              built.fallbackBox.depth,
            ]}
          />
          {slabMaterial}
        </mesh>
      )}
      {built.safetyStripe && (
        // The yellow tube is a universal MTA cue ("don't stand past this
        // line"). Strong emissive on the yellow keeps it readable in deep
        // tunnel fog without needing a station-light component yet.
        <mesh geometry={built.safetyStripe}>
          <meshStandardMaterial
            color={SAFETY_STRIPE_COLOR}
            roughness={0.45}
            metalness={0.1}
            emissive={SAFETY_STRIPE_COLOR}
            emissiveIntensity={0.45}
          />
        </mesh>
      )}
    </group>
  );
}

function buildPlatform(platform: PlatformFeature, origin: LatLon): BuiltPlatform {
  const lineKey = platform.line ?? "";
  const baseColor = LINE_COLOR[lineKey] ?? PLATFORM_FALLBACK_COLOR;
  const color = muteLineColor(baseColor);

  // ---- Slab extrusion ----
  // Build a closed 2D polygon in shape-space from the projected polyline.
  // Negate z because ExtrudeGeometry + rotateX flips that axis later.
  const pts: THREE.Vector2[] = [];
  for (const ll of platform.polyline) {
    const { x, z } = project(ll, origin);
    pts.push(new THREE.Vector2(x, -z));
  }
  if (pts.length >= 2 && pts[0].distanceTo(pts[pts.length - 1]) > 0.01) {
    pts.push(pts[0].clone());
  }

  const safetyStripe = buildSafetyStripe(platform.polyline, origin, platform.depthM);

  if (pts.length < 4) {
    return { slab: null, fallbackBox: null, safetyStripe, color };
  }

  try {
    const shape = new THREE.Shape(pts);
    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: SLAB_THICKNESS,
      bevelEnabled: false,
    });
    geom.rotateX(-Math.PI / 2);
    geom.translate(0, -SLAB_THICKNESS, 0);
    return { slab: geom, fallbackBox: null, safetyStripe, color };
  } catch {
    // Self-intersecting polygon → AABB fallback so the scene still renders.
    const projected = platform.polyline.map((p) => project(p, origin));
    const xs = projected.map((p) => p.x);
    const zs = projected.map((p) => p.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    return {
      slab: null,
      fallbackBox: {
        x: (minX + maxX) / 2,
        z: (minZ + maxZ) / 2,
        width: Math.max(maxX - minX, 1),
        depth: Math.max(maxZ - minZ, 1),
      },
      safetyStripe,
      color,
    };
  }
}

/**
 * Builds a closed yellow tube tracing the outline of a platform polygon at
 * slab-top elevation. Cheaper and simpler than computing an inward polygon
 * offset (which would need a Sutherland-Hodgman or similar): we just paint
 * the actual edge, and the resulting tube reads as a tactile-warning rim.
 *
 * Returns null for malformed polygons so the caller falls back to a slab
 * with no stripe rather than crashing on a CatmullRomCurve3 with too few
 * points.
 */
function buildSafetyStripe(
  polyline: LatLon[],
  origin: LatLon,
  depthM: number,
): THREE.TubeGeometry | null {
  if (polyline.length < 3) return null;

  const points: THREE.Vector3[] = [];
  for (const ll of polyline) {
    const { x, z } = project(ll, origin);
    points.push(new THREE.Vector3(x, depthM + SAFETY_STRIPE_LIFT, z));
  }
  // OSM way polygons usually repeat the first vertex at the end. CatmullRom
  // with closed=true handles closure itself, so drop the duplicate.
  if (
    points.length >= 2 &&
    points[0].distanceTo(points[points.length - 1]) < 0.05
  ) {
    points.pop();
  }
  if (points.length < 3) return null;

  // Dedup near-identical consecutive points — CatmullRom blows up on
  // zero-length segments, and this guard saved us before in Tracks.
  const deduped: THREE.Vector3[] = [];
  for (const p of points) {
    const last = deduped[deduped.length - 1];
    if (!last || last.distanceTo(p) > 0.05) deduped.push(p);
  }
  if (deduped.length < 3) return null;

  try {
    const curve = new THREE.CatmullRomCurve3(
      deduped,
      true,
      "centripetal",
      0.5,
    );
    const segments = Math.max(deduped.length * 6, 32);
    return new THREE.TubeGeometry(curve, segments, SAFETY_STRIPE_RADIUS, 5, true);
  } catch {
    return null;
  }
}

export { projectCentroid };
