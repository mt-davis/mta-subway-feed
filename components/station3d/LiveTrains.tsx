"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { TrainPosition, TrainsApiResponse } from "@/lib/types";
import type { PlatformFeature, LatLon } from "@/lib/station3d/types";
import { project, projectCentroid } from "@/lib/station3d/projection";
import { ROUTE_COLORS } from "@/lib/route-colors";

// Radius around the station (in meters) within which a train counts as
// "at this station". Union Square is ~150 m end-to-end across all platforms,
// so 250 m gives us a buffer for trains that are a few car-lengths off the
// stop point. Trains farther than this get filtered out so the scene stays
// focused on what's actually here.
const STATION_RADIUS_M = 250;

// How often we re-fetch /api/trains. Matches the existing 30 s cadence used
// by the 2D map — same upstream MTA refresh rate, no point in polling faster.
const POLL_INTERVAL_MS = 30_000;

interface SnappedTrain {
  train: TrainPosition;
  platformId: string;
  position: [number, number, number];
  color: string;
}

/**
 * Live train markers on the 3D scene. Polls /api/trains on a 30s interval,
 * filters to trains that are physically at this station, snaps each to the
 * platform whose `routes` array includes the train's routeId, and renders
 * a small colored capsule on the platform's surface.
 *
 * Snap target is each platform's centroid for v1 — refining to "actual point
 * along the platform polyline closest to the train's projected lat/lon" is a
 * small win that's worth doing once we have multiple stations to verify
 * against. Today the marker just answers "which platform is the next 6
 * train arriving at?", which is enough to be useful.
 */
export function LiveTrains({
  platforms,
  origin,
}: {
  platforms: PlatformFeature[];
  origin: LatLon;
}) {
  const [snappedTrains, setSnappedTrains] = useState<SnappedTrain[]>([]);

  // Pre-compute platform centroids + an index by route. Recompute only when
  // the platform list changes (effectively never during a session).
  const platformIndex = useMemo(() => {
    return platforms.map((p) => ({
      platform: p,
      centroid: projectCentroid(p.polyline, origin),
      routes: new Set(p.routes ?? []),
    }));
  }, [platforms, origin]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function poll() {
      try {
        const res = await fetch("/api/trains", { signal: controller.signal });
        if (!res.ok) return;
        const data: TrainsApiResponse = await res.json();
        if (cancelled) return;

        const snapped: SnappedTrain[] = [];
        for (const train of data.trains ?? []) {
          // Skip trains without coords (rare, but they show up in the feed).
          if (typeof train.lat !== "number" || typeof train.lon !== "number") {
            continue;
          }

          const { x, z } = project({ lat: train.lat, lon: train.lon }, origin);
          const distFromOrigin = Math.hypot(x, z);
          if (distFromOrigin > STATION_RADIUS_M) continue;

          // Find the platform whose routes match this train AND whose
          // centroid is closest to the train's projected position. The
          // closest-centroid tiebreaker matters for stations like Union
          // Square where multiple platforms serve the same line on the
          // opposite side (4/5/6 north and south).
          let best: { platformId: string; depth: number; cx: number; cz: number } | null = null;
          let bestDist = Infinity;
          for (const entry of platformIndex) {
            if (!entry.routes.has(train.routeId)) continue;
            const dx = entry.centroid.x - x;
            const dz = entry.centroid.z - z;
            const d = Math.hypot(dx, dz);
            if (d < bestDist) {
              bestDist = d;
              best = {
                platformId: entry.platform.id,
                depth: entry.platform.depthM,
                cx: entry.centroid.x,
                cz: entry.centroid.z,
              };
            }
          }
          if (!best) continue;

          snapped.push({
            train,
            platformId: best.platformId,
            // Sit the marker just above the platform surface (slab top is
            // exactly at platform.depthM by construction in PlatformSlabs).
            position: [best.cx, best.depth + 0.6, best.cz],
            color: ROUTE_COLORS[train.routeId] ?? "#9ca3af",
          });
        }

        setSnappedTrains(snapped);
      } catch (err) {
        // AbortError on cleanup is expected; everything else is logged but
        // not surfaced — a transient API hiccup shouldn't crash the scene.
        if ((err as Error).name !== "AbortError") {
          console.warn("[LiveTrains] fetch failed:", err);
        }
      }
    }

    void poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [platformIndex, origin]);

  return (
    <group>
      {snappedTrains.map((s) => (
        <TrainMarker key={s.train.id} snap={s} />
      ))}
    </group>
  );
}

function TrainMarker({ snap }: { snap: SnappedTrain }) {
  const groupRef = useRef<THREE.Group>(null);
  const isStopped = snap.train.status === "STOPPED_AT";

  // Gentle floating bob so even stopped trains feel "alive" — an entirely
  // static marker reads as a labelled spot on a map, not a vehicle. Stopped
  // trains bob more slowly than moving ones (different t-multipliers) which
  // matches how the 2D map renders status.
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    const speed = isStopped ? 0.6 : 1.4;
    const amplitude = 0.12;
    groupRef.current.position.y = snap.position[1] + Math.sin(t * speed) * amplitude;
  });

  return (
    <group ref={groupRef} position={snap.position}>
      {/* Capsule body, oriented vertically so it reads as a "train car
          standing on end" — a subway car icon without modeling an actual
          train. Length 1.2 m gives it real-world presence next to the
          life-sized platform slabs without overwhelming the scene. */}
      <mesh castShadow>
        <capsuleGeometry args={[0.45, 1.2, 8, 16]} />
        <meshStandardMaterial
          color={snap.color}
          metalness={0.3}
          roughness={0.45}
          emissive={snap.color}
          emissiveIntensity={isStopped ? 0.55 : 0.25}
        />
      </mesh>

      {/* Soft halo so the marker reads against the platform color even
          when the camera is far away. */}
      <mesh>
        <sphereGeometry args={[1.0, 16, 12]} />
        <meshBasicMaterial color={snap.color} transparent opacity={0.12} />
      </mesh>

      {/* Route bullet floating above the capsule. Html-based for the same
          reason PlatformLabels uses Html (see comment there): no font fetch,
          crisp DOM type, looks like an MTA bullet by default. */}
      <Html
        position={[0, 1.5, 0]}
        center
        // Constant screen size, same as PlatformLabels. The bullet's job is
        // to identify the train at a glance, not to look bigger when nearby.
        zIndexRange={[20, 10]}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: snap.color,
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily:
              'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            fontWeight: 800,
            fontSize: 11,
            letterSpacing: 0,
            // Subtle white ring so the bullet pops against busy platforms,
            // and never confused with a static platform-label bullet (which
            // is bigger and not ringed).
            boxShadow:
              "0 0 0 1.5px rgba(255,255,255,0.95), 0 2px 6px rgba(0,0,0,0.45)",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          {snap.train.routeId}
        </div>
      </Html>
    </group>
  );
}
