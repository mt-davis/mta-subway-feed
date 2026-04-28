"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, GizmoHelper, GizmoViewport } from "@react-three/drei";
import Link from "next/link";

import type { StationModel } from "@/lib/station3d/types";
import { Ground } from "@/components/station3d/Ground";
import { PlatformSlabs } from "@/components/station3d/PlatformSlabs";

export default function StationScene({ model }: { model: StationModel }) {
  return (
    <div className="relative w-full h-screen bg-slate-950 text-white">
      <header className="pointer-events-none absolute z-10 top-4 left-4 flex items-center gap-3">
        <Link
          href="/"
          className="pointer-events-auto rounded-md bg-white/10 backdrop-blur px-3 py-1.5 text-sm hover:bg-white/20 transition-colors"
        >
          ← Back to map
        </Link>
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/60">
            3D Station View
          </div>
          <h1 className="text-lg font-semibold leading-tight">{model.name}</h1>
        </div>
      </header>

      <div className="pointer-events-none absolute z-10 bottom-4 left-4 rounded-md bg-white/10 backdrop-blur px-3 py-2 text-xs leading-relaxed">
        <div className="text-white/70 mb-1">
          {model.platforms.length} platforms · {model.tracks.length} tracks ·{" "}
          {model.stairs.length} stairs · {model.entrances.length} entrances
        </div>
        <div className="text-white/50">Drag to rotate · scroll to zoom</div>
      </div>

      <Canvas
        camera={{ position: [40, 25, 40], fov: 50, near: 0.1, far: 1000 }}
        shadows
      >
        <color attach="background" args={["#0f172a"]} />
        <fog attach="fog" args={["#0f172a", 80, 280]} />

        <ambientLight intensity={0.45} />
        <directionalLight
          position={[20, 30, 10]}
          intensity={1.1}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-60}
          shadow-camera-right={60}
          shadow-camera-top={60}
          shadow-camera-bottom={-60}
        />

        <Ground />
        <PlatformSlabs platforms={model.platforms} origin={model.center} />

        <OrbitControls
          makeDefault
          enableDamping
          minDistance={5}
          maxDistance={200}
          target={[0, -8, 0]}
        />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3b82f6"]} />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
