"use client";

import { Grid } from "@react-three/drei";

/**
 * Street-level reference. Two layers stacked at y=0:
 *
 *   1. A wide, very-dark translucent disk that suggests "this is the
 *      surface". It receives shadows from the entrance kiosks above ground
 *      and casts a subtle horizon line where it meets the fog. Crucially
 *      it's only ~6% opaque, so the underground geometry still reads
 *      cleanly through it — the cutaway view is preserved.
 *
 *   2. The grid on top, with subdued line colors so the grid no longer
 *      competes visually with the (now polished) tracks/platforms below.
 *
 * Reasoning behind layering vs. a single mesh: a fully-opaque street would
 * occlude the cutaway. A grid alone (the previous behavior) didn't give
 * the eye anything to "land on" as ground, so the entrance kiosks looked
 * like they were floating above a void.
 */
export function Ground() {
  return (
    <group>
      {/* Translucent street disk. renderOrder + depthWrite=false keeps it
          from punching a transparent hole through the platforms below. */}
      <mesh
        position={[0, -0.005, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        renderOrder={-1}
      >
        <circleGeometry args={[140, 64]} />
        <meshStandardMaterial
          color="#0b1224"
          roughness={1}
          metalness={0}
          transparent
          opacity={0.35}
          depthWrite={false}
        />
      </mesh>

      {/* The grid — slightly muted so it sits behind the foreground
          geometry instead of fighting it. Cell size 5 m / section 25 m
          gives a rhythm that matches NYC block scale. */}
      <Grid
        args={[200, 200]}
        position={[0, 0, 0]}
        cellSize={5}
        cellThickness={0.4}
        cellColor="#334155"
        sectionSize={25}
        sectionThickness={0.9}
        sectionColor="#64748b"
        infiniteGrid={false}
        fadeDistance={140}
        side={2}
      />
    </group>
  );
}
