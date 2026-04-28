"use client";

import { useMemo } from "react";
import type { EntranceFeature, LatLon } from "@/lib/station3d/types";
import { project } from "@/lib/station3d/projection";

// Simple stylized take on an NYC subway entrance marker: a foundation pad,
// a vertical post, and a glowing colored globe at the top. Modeled in
// real-world meters so the marker scales naturally next to the platforms.
const PAD_SIZE_M = 1.0;
const PAD_HEIGHT_M = 0.08;
const POST_CROSS_M = 0.16;
const POST_HEIGHT_M = 2.5;
const GLOBE_RADIUS_M = 0.3;

// Accessibility palette — same color scheme as before, just applied to the
// globe instead of the whole pin so the rest of the marker can read as a
// neutral metal post.
const ACCESSIBLE_COLOR = "#3b82f6"; // blue 500
const LIMITED_COLOR = "#a78bfa"; // violet 400
const NON_ACCESSIBLE_COLOR = "#94a3b8"; // slate 400

const PAD_COLOR = "#1f2937"; // very dark slate — concrete in shadow
const POST_COLOR = "#475569"; // mid slate — painted steel

export function Entrances({
  entrances,
  origin,
}: {
  entrances: EntranceFeature[];
  origin: LatLon;
}) {
  return (
    <group>
      {entrances.map((e) => (
        <Entrance key={e.id} entrance={e} origin={origin} />
      ))}
    </group>
  );
}

function globeColor(wheelchair: EntranceFeature["wheelchair"]): string {
  if (wheelchair === "yes" || wheelchair === "designated") {
    return ACCESSIBLE_COLOR;
  }
  if (wheelchair === "limited") return LIMITED_COLOR;
  return NON_ACCESSIBLE_COLOR;
}

function Entrance({
  entrance,
  origin,
}: {
  entrance: EntranceFeature;
  origin: LatLon;
}) {
  const position = useMemo(() => {
    const { x, z } = project(entrance.position, origin);
    // Sit the entire group on the street plane (y=0). Each child positions
    // itself relative to that anchor.
    return [x, 0, z] as [number, number, number];
  }, [entrance, origin]);

  const accent = globeColor(entrance.wheelchair);

  return (
    <group position={position}>
      {/* Foundation pad — a small concrete square the post stands on. Sits
          centered at ground level with its top at PAD_HEIGHT_M. Receives
          shadow from the post + globe so the marker grounds visually. */}
      <mesh position={[0, PAD_HEIGHT_M / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[PAD_SIZE_M, PAD_HEIGHT_M, PAD_SIZE_M]} />
        <meshStandardMaterial
          color={PAD_COLOR}
          roughness={0.92}
          metalness={0.05}
        />
      </mesh>

      {/* Vertical post. Square cross-section so it reads as fabricated
          metal rather than a generic cylinder. Slight metalness gives it
          the painted-steel sheen NYC entrance posts actually have. */}
      <mesh
        position={[0, PAD_HEIGHT_M + POST_HEIGHT_M / 2, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[POST_CROSS_M, POST_HEIGHT_M, POST_CROSS_M]} />
        <meshStandardMaterial
          color={POST_COLOR}
          roughness={0.55}
          metalness={0.55}
        />
      </mesh>

      {/* Globe — the most recognizable bit of the NYC entrance look.
          Emissive so it glows like a real station lamp; color encodes
          accessibility status, which keeps the at-a-glance signal we had
          with the colored-pin design. */}
      <mesh
        position={[0, PAD_HEIGHT_M + POST_HEIGHT_M + GLOBE_RADIUS_M * 0.9, 0]}
        castShadow
      >
        <sphereGeometry args={[GLOBE_RADIUS_M, 18, 14]} />
        <meshStandardMaterial
          color={accent}
          metalness={0.1}
          roughness={0.35}
          emissive={accent}
          emissiveIntensity={0.6}
        />
      </mesh>
    </group>
  );
}
