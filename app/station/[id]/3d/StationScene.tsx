"use client";

import { useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, GizmoHelper, GizmoViewport } from "@react-three/drei";
import Link from "next/link";

import type { StationModel } from "@/lib/station3d/types";
import { Ground } from "@/components/station3d/Ground";
import { PlatformSlabs } from "@/components/station3d/PlatformSlabs";
import { Tracks } from "@/components/station3d/Tracks";
import { Stairs } from "@/components/station3d/Stairs";
import { Entrances } from "@/components/station3d/Entrances";

interface CameraPreset {
  id: string;
  label: string;
  description: string;
  position: [number, number, number];
  target: [number, number, number];
}

const CAMERA_PRESETS: CameraPreset[] = [
  {
    id: "overview",
    label: "Overview",
    description: "Default angled view of the whole station",
    position: [55, 45, 55],
    target: [0, -8, 0],
  },
  {
    id: "top",
    label: "Top down",
    description: "Plan view from above",
    position: [0, 90, 0.001], // 0.001 z avoids gimbal lock when straight down
    target: [0, 0, 0],
  },
  {
    id: "lex",
    label: "Lex (4/5/6)",
    description: "Angled view focused on the IRT Lexington level",
    position: [35, -1, 35],
    target: [0, -10, 0],
  },
  {
    id: "canarsie",
    label: "Canarsie (L)",
    description: "Side view of the deep L line at level −3",
    position: [0, -10, 45],
    target: [0, -16, 0],
  },
];

// Drei doesn't expose a clean type for the OrbitControls implementation that
// works without depending on three-stdlib directly, but the only methods we
// need are object.position.set, target.set, and update(). A minimal structural
// type keeps this honest without dragging in extra typings.
interface OrbitControlsLike {
  object: { position: { set: (x: number, y: number, z: number) => void } };
  target: { set: (x: number, y: number, z: number) => void };
  update: () => void;
}

export default function StationScene({ model }: { model: StationModel }) {
  const controlsRef = useRef<OrbitControlsLike | null>(null);
  const [activePreset, setActivePreset] = useState<string>("overview");

  function applyPreset(preset: CameraPreset) {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.object.position.set(...preset.position);
    controls.target.set(...preset.target);
    controls.update();
    setActivePreset(preset.id);
  }

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

      {/* Camera preset rail — top-right.
          Sits on top of the Canvas as a regular DOM element; clicks call
          OrbitControls directly via ref so the camera snaps to the preset
          without any extra animation infrastructure. Highlighting the active
          preset gives the user a sense of "where am I looking right now". */}
      <div className="pointer-events-auto absolute z-10 top-4 right-4 flex flex-col gap-1.5 rounded-lg bg-white/10 backdrop-blur p-2 ring-1 ring-white/15">
        <div className="px-2 pb-1 text-[10px] uppercase tracking-[0.18em] text-white/50">
          View
        </div>
        {CAMERA_PRESETS.map((preset) => {
          const isActive = activePreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              title={preset.description}
              className={`text-left text-xs px-3 py-1.5 rounded-md transition-colors ${
                isActive
                  ? "bg-blue-500/80 text-white shadow-sm"
                  : "bg-white/5 hover:bg-white/15 text-white/85"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="pointer-events-none absolute z-10 bottom-4 left-4 rounded-md bg-white/10 backdrop-blur px-3 py-2 text-xs leading-relaxed">
        <div className="text-white/70 mb-1">
          {model.platforms.length} platforms · {model.tracks.length} tracks ·{" "}
          {model.stairs.length} stairs · {model.entrances.length} entrances
        </div>
        <div className="text-white/50">Drag to rotate · scroll to zoom</div>
      </div>

      <Canvas
        camera={{ position: [55, 45, 55], fov: 50, near: 0.1, far: 1000 }}
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
        <Tracks tracks={model.tracks} origin={model.center} />
        <PlatformSlabs platforms={model.platforms} origin={model.center} />
        <Stairs stairs={model.stairs} origin={model.center} />
        <Entrances entrances={model.entrances} origin={model.center} />

        <OrbitControls
          ref={(instance) => {
            controlsRef.current = instance as OrbitControlsLike | null;
          }}
          makeDefault
          enableDamping
          minDistance={5}
          maxDistance={200}
          target={[0, -8, 0]}
          // Reset the active preset to "free" if the user starts dragging
          // so the highlight pill doesn't lie about where the camera is.
          onStart={() => {
            setActivePreset("");
          }}
        />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3b82f6"]} />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
