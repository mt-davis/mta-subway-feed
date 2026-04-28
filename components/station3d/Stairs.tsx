"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { StairsFeature, LatLon } from "@/lib/station3d/types";
import { project } from "@/lib/station3d/projection";

// Width of the stair tread (orthogonal to the stair direction). 1.4 m matches
// MTA's typical platform-to-mezzanine staircase — wide enough for two
// abreast, narrow enough that the cluster of stairs at a single platform
// doesn't form one continuous yellow blob.
const STAIR_WIDTH_M = 1.4;
const HALF_WIDTH = STAIR_WIDTH_M / 2;

// Tread "ridges" — small dark bars laid perpendicular to the ramp every
// TREAD_SPACING_M, suggesting individual steps. Real treads are ~0.28 m
// (NYC building code), but at 0.4 m the pattern reads cleanly without moiré
// at typical orbit distances.
const TREAD_SPACING_M = 0.4;
const TREAD_THICKNESS_M = 0.06;
const TREAD_HEIGHT_M = 0.08;
const TREAD_LIFT_M = 0.04; // sit treads just above the ramp surface

// Concrete-amber palette. Brighter than real concrete but keeps the existing
// "yellow = stair" visual ID — riders recognize stairs by color in the
// scene more than by shape.
const RAMP_COLOR = "#d97706"; // amber 600 — warm concrete
const TREAD_COLOR = "#451a03"; // dark brown — high-contrast nosing

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
        <StairRamp key={s.id} stair={s} origin={origin} />
      ))}
    </group>
  );
}

interface BuiltStair {
  ramp: THREE.BufferGeometry;
  treads: THREE.InstancedMesh;
}

function StairRamp({
  stair,
  origin,
}: {
  stair: StairsFeature;
  origin: LatLon;
}) {
  const built = useMemo<BuiltStair | null>(
    () => buildStair(stair, origin),
    [stair, origin],
  );

  if (!built) return null;

  return (
    <group>
      <mesh geometry={built.ramp} castShadow receiveShadow>
        <meshStandardMaterial
          color={RAMP_COLOR}
          roughness={0.85}
          metalness={0.05}
          // Amber emissive at low intensity keeps the stairs faintly visible
          // even in deep tunnel fog where the ramp's downward normal would
          // otherwise be unlit.
          emissive={RAMP_COLOR}
          emissiveIntensity={0.08}
          // Doubled-sided so the underside of the ramp is shaded instead of
          // showing through transparently when looking up from below.
          side={THREE.DoubleSide}
        />
      </mesh>
      <primitive object={built.treads} />
    </group>
  );
}

/**
 * Builds two pieces from a stair polyline:
 *
 *   1. A flat ramp surface (BufferGeometry) — quad strip of width
 *      STAIR_WIDTH_M centered on the polyline, with Y interpolated by
 *      cumulative arc length between fromDepthM and toDepthM. Per-vertex
 *      normals are derived from the segment's local tangent + right vector
 *      so lighting reads as a continuously inclined surface, not a stack
 *      of flat polygons.
 *
 *   2. An InstancedMesh of small dark "tread" bars placed every
 *      TREAD_SPACING_M along the centerline, oriented to lie across the
 *      ramp. The bars give the eye a step rhythm without modeling each
 *      stair as a separate riser+tread (which would balloon geometry on
 *      the 34 stairs at Union Square).
 *
 * Returns null for stairs shorter than 0.5 m horizontal — those are usually
 * OSM nodes that snapped to a single point and wouldn't render usefully.
 */
function buildStair(stair: StairsFeature, origin: LatLon): BuiltStair | null {
  if (stair.polyline.length < 2) return null;

  const planar = stair.polyline.map((ll) => project(ll, origin));

  // Cumulative horizontal arc length — used to ramp Y linearly along the
  // path, so the slope stays consistent regardless of vertex density.
  const cumDist: number[] = [0];
  for (let i = 1; i < planar.length; i++) {
    const dx = planar[i].x - planar[i - 1].x;
    const dz = planar[i].z - planar[i - 1].z;
    cumDist.push(cumDist[i - 1] + Math.hypot(dx, dz));
  }
  const totalLen = cumDist[cumDist.length - 1];
  if (totalLen < 0.5) return null;

  // Build 3D centerline points with depth interpolated by arc length.
  const center: THREE.Vector3[] = [];
  for (let i = 0; i < planar.length; i++) {
    const t = totalLen > 0 ? cumDist[i] / totalLen : 0;
    const y = stair.fromDepthM + (stair.toDepthM - stair.fromDepthM) * t;
    center.push(new THREE.Vector3(planar[i].x, y, planar[i].z));
  }

  // ---- Ramp surface ----
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);

  // Per-vertex tangent. Use the average of incoming + outgoing segments for
  // interior vertices so the right-vector seam between adjacent quads
  // doesn't produce visible kinks.
  const incomingTan = new THREE.Vector3();
  const outgoingTan = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const tanFlat = new THREE.Vector3();
  const right = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i < center.length; i++) {
    if (i === 0) {
      tan.copy(center[1]).sub(center[0]);
    } else if (i === center.length - 1) {
      tan.copy(center[i]).sub(center[i - 1]);
    } else {
      incomingTan.copy(center[i]).sub(center[i - 1]).normalize();
      outgoingTan.copy(center[i + 1]).sub(center[i]).normalize();
      tan.addVectors(incomingTan, outgoingTan);
    }

    // Right vector lives in the XZ plane (perpendicular to the horizontal
    // projection of the tangent). Keeps the ramp width constant in plan
    // view regardless of slope angle.
    tanFlat.set(tan.x, 0, tan.z);
    if (tanFlat.lengthSq() < 1e-8) {
      tanFlat.set(1, 0, 0);
    } else {
      tanFlat.normalize();
    }
    right.crossVectors(tanFlat, up).normalize();

    // Left vertex (offset along +right), then right vertex (offset along
    // -right). Two verts per centerline sample.
    const leftV = center[i].clone().addScaledVector(right, HALF_WIDTH);
    const rightV = center[i].clone().addScaledVector(right, -HALF_WIDTH);
    positions.push(leftV.x, leftV.y, leftV.z);
    positions.push(rightV.x, rightV.y, rightV.z);

    // Normal: tangent × right, flipped if it ended up pointing down. Gives
    // a properly-tilted face normal so the directional light shades the
    // ramp surface and not its shadow side.
    normal.crossVectors(tan.clone().normalize(), right);
    if (normal.y < 0) normal.negate();
    normal.normalize();
    normals.push(normal.x, normal.y, normal.z);
    normals.push(normal.x, normal.y, normal.z);
  }

  // Triangulate the strip: each pair of adjacent centerline samples forms
  // a quad (left_i, right_i, left_{i+1}, right_{i+1}) → two triangles.
  for (let i = 0; i < center.length - 1; i++) {
    const a = i * 2; // left at i
    const b = i * 2 + 1; // right at i
    const c = (i + 1) * 2; // left at i+1
    const d = (i + 1) * 2 + 1; // right at i+1
    indices.push(a, c, b);
    indices.push(b, c, d);
  }

  const ramp = new THREE.BufferGeometry();
  ramp.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  ramp.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  ramp.setIndex(indices);

  // ---- Treads ----
  // Walk the centerline at TREAD_SPACING_M arc-length intervals and place
  // an oriented box at each step.
  const treadCount = Math.max(Math.floor(totalLen / TREAD_SPACING_M), 1);
  const tieMatrices: THREE.Matrix4[] = [];

  for (let i = 1; i <= treadCount; i++) {
    const targetDist = (i / (treadCount + 1)) * totalLen;

    // Find which segment of the centerline this distance lands in.
    let segIdx = 0;
    while (segIdx < cumDist.length - 2 && cumDist[segIdx + 1] < targetDist) {
      segIdx++;
    }
    const segStart = cumDist[segIdx];
    const segLen = cumDist[segIdx + 1] - segStart;
    if (segLen <= 0) continue;
    const segT = (targetDist - segStart) / segLen;

    const pos = new THREE.Vector3().lerpVectors(
      center[segIdx],
      center[segIdx + 1],
      segT,
    );

    // Tangent for orientation. Use the *full* (3D) segment direction so the
    // tread tilts with the ramp's slope rather than lying horizontally
    // through the surface.
    tan.copy(center[segIdx + 1]).sub(center[segIdx]);
    if (tan.lengthSq() < 1e-8) continue;

    tanFlat.set(tan.x, 0, tan.z);
    if (tanFlat.lengthSq() < 1e-8) continue;
    tanFlat.normalize();
    right.crossVectors(tanFlat, up).normalize();

    // Surface normal of the ramp at this point — used to lift the tread
    // off the ramp surface along the ramp's actual normal (not just +Y),
    // so the gap is consistent regardless of slope.
    normal.crossVectors(tan.clone().normalize(), right);
    if (normal.y < 0) normal.negate();
    normal.normalize();
    pos.addScaledVector(normal, TREAD_LIFT_M);

    const m = new THREE.Matrix4().makeBasis(
      right,
      normal,
      tan.clone().normalize(),
    );
    m.setPosition(pos);
    tieMatrices.push(m);
  }

  const treadGeo = new THREE.BoxGeometry(
    STAIR_WIDTH_M,
    TREAD_HEIGHT_M,
    TREAD_THICKNESS_M,
  );
  const treadMat = new THREE.MeshStandardMaterial({
    color: TREAD_COLOR,
    roughness: 0.95,
    metalness: 0,
  });
  const treads = new THREE.InstancedMesh(treadGeo, treadMat, tieMatrices.length);
  treads.castShadow = true;
  treads.receiveShadow = true;
  for (let i = 0; i < tieMatrices.length; i++) {
    treads.setMatrixAt(i, tieMatrices[i]);
  }
  treads.instanceMatrix.needsUpdate = true;

  return { ramp, treads };
}
