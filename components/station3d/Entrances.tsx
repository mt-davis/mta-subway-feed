"use client";

import { useMemo } from "react";
import type { EntranceFeature, LatLon } from "@/lib/station3d/types";
import { project } from "@/lib/station3d/projection";

const PIN_HEIGHT = 1.6;
const PIN_RADIUS = 0.4;

const ACCESSIBLE_COLOR = "#3b82f6"; // blue-500
const NON_ACCESSIBLE_COLOR = "#94a3b8"; // slate-400
const LIMITED_COLOR = "#a78bfa"; // violet-400

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

function pickColor(wheelchair: EntranceFeature["wheelchair"]): string {
  if (wheelchair === "yes" || wheelchair === "designated") return ACCESSIBLE_COLOR;
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
    return [x, 0, z] as [number, number, number];
  }, [entrance, origin]);

  const color = pickColor(entrance.wheelchair);

  return (
    <group position={position}>
      {/* Pole / pin body */}
      <mesh position={[0, PIN_HEIGHT / 2, 0]} castShadow>
        <cylinderGeometry args={[PIN_RADIUS * 0.4, PIN_RADIUS * 0.4, PIN_HEIGHT, 12]} />
        <meshStandardMaterial color={color} metalness={0.2} roughness={0.6} />
      </mesh>
      {/* Cap on top */}
      <mesh position={[0, PIN_HEIGHT, 0]} castShadow>
        <sphereGeometry args={[PIN_RADIUS, 16, 12]} />
        <meshStandardMaterial
          color={color}
          metalness={0.3}
          roughness={0.45}
          emissive={color}
          emissiveIntensity={0.4}
        />
      </mesh>
    </group>
  );
}
