"use client";

import { useMemo } from "react";
import { Html } from "@react-three/drei";
import type { PlatformFeature, LatLon } from "@/lib/station3d/types";
import { projectCentroid } from "@/lib/station3d/projection";
import { ROUTE_COLORS } from "@/lib/route-colors";

const LABEL_HEIGHT_OFFSET = 2.4; // meters above the slab surface

/**
 * Floating route-bullet labels above each platform. Implemented as drei
 * <Html> rather than <Text>:
 *
 *   - <Text> requires troika-three-text to fetch and SDF-encode a font from
 *     the network, which can fail silently in some sandboxes and leaves the
 *     label invisible until the font lands. Hard to debug, easy to break.
 *   - <Html> is just DOM, so we get crisp, anti-aliased type the moment the
 *     scene mounts, and we can style it like the real subway bullets the
 *     2D map already uses (round pill, line color, white text).
 *
 * Tradeoff: <Html> doesn't participate in 3D depth-testing — a label tucked
 * behind a platform slab still renders on top. For overhead labels that's
 * exactly what we want; you should always be able to read which line is
 * which from any angle.
 */
export function PlatformLabels({
  platforms,
  origin,
}: {
  platforms: PlatformFeature[];
  origin: LatLon;
}) {
  return (
    <group>
      {platforms.map((p) => (
        <PlatformLabel key={p.id} platform={p} origin={origin} />
      ))}
    </group>
  );
}

function PlatformLabel({
  platform,
  origin,
}: {
  platform: PlatformFeature;
  origin: LatLon;
}) {
  const { centroid, bullets } = useMemo(() => {
    const c = projectCentroid(platform.polyline, origin);
    const routes = platform.routes ?? [];
    return { centroid: c, bullets: routes };
  }, [platform, origin]);

  if (bullets.length === 0) return null;

  return (
    <Html
      position={[centroid.x, platform.depthM + LABEL_HEIGHT_OFFSET, centroid.z]}
      // center prop translates the html box -50%/-50% so the position
      // refers to the bullet group's center, not its top-left corner.
      center
      // No distanceFactor: labels stay the same screen size regardless of
      // zoom. This trades photorealism for legibility — at any orbit
      // distance you can always read which line is which, which is the
      // whole point of a label.
      zIndexRange={[10, 0]}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          pointerEvents: "none",
          userSelect: "none",
          // Soft outer glow so the bullets stay readable against any
          // platform color underneath.
          filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.45))",
        }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          {bullets.map((route) => (
            <RouteBullet key={route} route={route} />
          ))}
        </div>
        {/* Depth caption. Helps disambiguate when multiple platforms serve
            identical routes (e.g. four Lex platforms at Union Square all
            labelled "4·5·6") — the depth still makes sense per-platform
            once we add stacked layouts in a future revision. */}
        <div
          style={{
            fontFamily:
              'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            fontSize: 10,
            fontWeight: 600,
            color: "rgba(255,255,255,0.85)",
            background: "rgba(15,23,42,0.7)",
            padding: "1px 6px",
            borderRadius: 999,
            letterSpacing: 0.2,
          }}
        >
          {Math.round(platform.depthM)} m
        </div>
      </div>
    </Html>
  );
}

function RouteBullet({ route }: { route: string }) {
  const color = ROUTE_COLORS[route] ?? "#9ca3af";
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: color,
        color: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        fontWeight: 800,
        fontSize: 14,
        letterSpacing: 0,
        boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.18)",
      }}
    >
      {route}
    </div>
  );
}
