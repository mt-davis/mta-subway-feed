"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { TrackFeature, LatLon } from "@/lib/station3d/types";
import { project } from "@/lib/station3d/projection";

// NYCT runs standard gauge across every line, IRT through IND.
// 1.435 m rail-to-rail center distance.
const GAUGE_M = 1.435;

// Rail tube radius. Real rail head is ~0.07 m wide, but rounding up a touch
// makes the rails read clearly from typical orbit distances without looking
// chunky up close.
const RAIL_RADIUS_M = 0.075;

// Crossties: ~2.4 m long (longer than the gauge so they stick out either side
// of the rails the way real ties do), ~0.22 m wide along the track direction,
// 0.15 m thick. Spaced 1.5 m apart — twice the typical IRL spacing of ~0.7 m,
// but at our viewing distances a denser tie field reads as moiré rather than
// "tracks". 1.5 m gives a clean rhythm.
const TIE_LENGTH_M = 2.4;
const TIE_HEIGHT_M = 0.15;
const TIE_WIDTH_M = 0.22;
const TIE_SPACING_M = 1.5;

// We keep the per-level color identity, but apply it as a *subtle emissive
// sheen* on the steel rails rather than painting the whole track. From a
// distance you still see "the green tracks are Lex"; up close the rails read
// as actual rails. Platforms + labels do the heavy lifting on line ID.
const RAIL_EMISSIVE_BY_LEVEL: Record<string, string> = {
  "-1": "#fbbf24",
  "-2": "#34d399",
  "-3": "#cbd5e1",
};
const RAIL_EMISSIVE_FALLBACK = "#94a3b8";

const RAIL_BASE_COLOR = "#9aa0a6"; // weathered steel, slightly cool
const TIE_COLOR = "#1f1a15"; // creosoted wood / dark concrete

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
        <TrackRails key={t.id} track={t} origin={origin} />
      ))}
    </group>
  );
}

interface BuiltTrack {
  leftRail: THREE.TubeGeometry;
  rightRail: THREE.TubeGeometry;
  tieMesh: THREE.InstancedMesh;
}

function TrackRails({
  track,
  origin,
}: {
  track: TrackFeature;
  origin: LatLon;
}) {
  const built = useMemo<BuiltTrack | null>(
    () => buildTrack(track, origin),
    [track, origin],
  );

  if (!built) return null;

  const emissive =
    RAIL_EMISSIVE_BY_LEVEL[String(track.level)] ?? RAIL_EMISSIVE_FALLBACK;

  return (
    <group>
      <mesh geometry={built.leftRail} castShadow receiveShadow>
        <meshStandardMaterial
          color={RAIL_BASE_COLOR}
          metalness={0.85}
          roughness={0.4}
          emissive={emissive}
          emissiveIntensity={0.22}
        />
      </mesh>
      <mesh geometry={built.rightRail} castShadow receiveShadow>
        <meshStandardMaterial
          color={RAIL_BASE_COLOR}
          metalness={0.85}
          roughness={0.4}
          emissive={emissive}
          emissiveIntensity={0.22}
        />
      </mesh>
      {/* Ties as a single instanced mesh per track. ~50 instances each at
          worst, 24 tracks → ~1200 box instances total — well under any
          performance budget for the scene. */}
      <primitive object={built.tieMesh} />
    </group>
  );
}

/**
 * Walks the OSM polyline, projects to local meters at the track's depth,
 * builds a smooth Catmull-Rom centerline, then derives the two rail center
 * curves by offsetting perpendicular to the tangent at each sample. Returns
 * the two rail TubeGeometries plus an InstancedMesh of crossties placed
 * every TIE_SPACING_M along the centerline.
 *
 * Returns null if the polyline can't form a usable curve (fewer than 2
 * unique points after dedup). Callers should render nothing in that case.
 */
function buildTrack(track: TrackFeature, origin: LatLon): BuiltTrack | null {
  if (track.polyline.length < 2) return null;

  // 1. Project polyline → flat XZ points at track depth.
  const projected = track.polyline.map((ll) => {
    const { x, z } = project(ll, origin);
    return new THREE.Vector3(x, track.depthM, z);
  });

  // CatmullRomCurve3 fails on zero-length segments; OSM nodes can collide
  // exactly when two ways share a junction, so dedup is necessary.
  const deduped: THREE.Vector3[] = [];
  for (const p of projected) {
    const last = deduped[deduped.length - 1];
    if (!last || last.distanceTo(p) > 0.001) deduped.push(p);
  }
  if (deduped.length < 2) return null;

  const center = new THREE.CatmullRomCurve3(
    deduped,
    false,
    "centripetal",
    0.5,
  );

  // 2. Walk the centerline at fixed spacing, sampling tangents to compute
  // the perpendicular "right" vector. Because all tracks are flat in our
  // scene (constant y = track.depthM), the right vector is always parallel
  // to the XZ plane and tangent × up is well-defined.
  const length = center.getLength();
  const sampleCount = Math.max(Math.ceil(length / 0.5), 16);
  const leftPts: THREE.Vector3[] = [];
  const rightPts: THREE.Vector3[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const tan = new THREE.Vector3();
  const right = new THREE.Vector3();

  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const pos = center.getPoint(t);
    center.getTangent(t, tan);
    right.crossVectors(tan, up);
    if (right.lengthSq() < 1e-8) {
      // Degenerate tangent — fall back to a fixed axis so we still emit
      // a rail rather than a NaN-filled mesh.
      right.set(1, 0, 0);
    } else {
      right.normalize();
    }
    leftPts.push(pos.clone().addScaledVector(right, GAUGE_M / 2));
    rightPts.push(pos.clone().addScaledVector(right, -GAUGE_M / 2));
  }

  const leftCurve = new THREE.CatmullRomCurve3(
    leftPts,
    false,
    "centripetal",
    0.5,
  );
  const rightCurve = new THREE.CatmullRomCurve3(
    rightPts,
    false,
    "centripetal",
    0.5,
  );

  const tubularSegments = Math.max(sampleCount, 16);
  const leftRail = new THREE.TubeGeometry(
    leftCurve,
    tubularSegments,
    RAIL_RADIUS_M,
    6,
    false,
  );
  const rightRail = new THREE.TubeGeometry(
    rightCurve,
    tubularSegments,
    RAIL_RADIUS_M,
    6,
    false,
  );

  // 3. Crossties: place a box at every TIE_SPACING_M, oriented so its long
  // axis matches the right vector and its short horizontal axis matches the
  // tangent. Sit them slightly below the rail head — ties IRL are below the
  // top of rail by ~0.1 m, and the small offset hides any z-fighting between
  // the tie boxes and the rail tubes at the contact point.
  const tieCount = Math.max(Math.floor(length / TIE_SPACING_M), 1);
  const matrices: THREE.Matrix4[] = [];
  const TIE_DEPTH_OFFSET = 0.08;

  for (let i = 0; i <= tieCount; i++) {
    const t = i / tieCount;
    const pos = center.getPoint(t);
    center.getTangent(t, tan);
    right.crossVectors(tan, up);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    else right.normalize();

    pos.y -= TIE_DEPTH_OFFSET;

    // Box geometry's local axes: X = length (TIE_LENGTH_M), Y = height,
    // Z = width (along tangent). makeBasis sets columns to (X, Y, Z) world
    // directions, so we map (right, up, tan).
    const m = new THREE.Matrix4().makeBasis(right, up, tan);
    m.setPosition(pos);
    matrices.push(m);
  }

  const tieGeo = new THREE.BoxGeometry(TIE_LENGTH_M, TIE_HEIGHT_M, TIE_WIDTH_M);
  const tieMat = new THREE.MeshStandardMaterial({
    color: TIE_COLOR,
    roughness: 0.92,
    metalness: 0.0,
  });
  const tieMesh = new THREE.InstancedMesh(tieGeo, tieMat, matrices.length);
  tieMesh.castShadow = true;
  tieMesh.receiveShadow = true;
  for (let i = 0; i < matrices.length; i++) {
    tieMesh.setMatrixAt(i, matrices[i]);
  }
  tieMesh.instanceMatrix.needsUpdate = true;

  return { leftRail, rightRail, tieMesh };
}
