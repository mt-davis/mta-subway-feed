"use client";

import { Grid } from "@react-three/drei";

/**
 * Street-level reference grid. We deliberately omit a solid plane so the
 * underground geometry (platforms, tracks) stays visible — this is a
 * cutaway view, not a top-down view of the street.
 */
export function Ground() {
  return (
    <Grid
      args={[200, 200]}
      position={[0, 0, 0]}
      cellSize={5}
      cellThickness={0.5}
      cellColor="#475569"
      sectionSize={25}
      sectionThickness={1}
      sectionColor="#94a3b8"
      infiniteGrid={false}
      fadeDistance={140}
      side={2}
    />
  );
}
