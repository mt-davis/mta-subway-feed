"use client";

import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, GizmoHelper, GizmoViewport } from "@react-three/drei";
import Link from "next/link";

import type { StationModel } from "@/lib/station3d/types";
import {
  CAMERA_PRESETS,
  type CameraPreset,
  getPreset,
} from "@/lib/station3d/cameraPresets";
import { Ground } from "@/components/station3d/Ground";
import { PlatformSlabs } from "@/components/station3d/PlatformSlabs";
import { PlatformLabels } from "@/components/station3d/PlatformLabels";
import { PlatformLights } from "@/components/station3d/PlatformLights";
import { Tracks } from "@/components/station3d/Tracks";
import { Stairs } from "@/components/station3d/Stairs";
import { Entrances } from "@/components/station3d/Entrances";
import { LiveTrains } from "@/components/station3d/LiveTrains";
import { CameraRig } from "@/components/station3d/CameraRig";

const INITIAL_PRESET = "overview";

export default function StationScene({ model }: { model: StationModel }) {
  // Two pieces of state intentionally:
  //   - `activePresetId` drives the highlighted button + currently advertised
  //     view. Cleared the moment the user starts dragging so the highlight
  //     never lies about where the camera is.
  //   - `tweenTarget` is what CameraRig actually animates toward. We make a
  //     fresh wrapper object on every preset click so clicking the *same*
  //     preset twice still re-fires the lerp — useful when the user has
  //     drifted off and wants to recenter.
  const [activePresetId, setActivePresetId] = useState<string>(INITIAL_PRESET);
  const [tweenTarget, setTweenTarget] = useState<CameraPreset | null>(null);

  function applyPreset(preset: CameraPreset) {
    // Spread to force a new object identity so CameraRig's useEffect re-fires
    // even if the user clicks the same preset twice in a row.
    setTweenTarget({ ...preset });
    setActivePresetId(preset.id);
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

      {/* Camera preset rail (top-right). Active state drives the blue
          highlight; OrbitControls.onStart clears the active id (but NOT the
          tween target — we keep that consistent so the user can resume the
          last preset by clicking it again). */}
      <div className="pointer-events-auto absolute z-10 top-4 right-4 flex flex-col gap-1.5 rounded-lg bg-white/10 backdrop-blur p-2 ring-1 ring-white/15">
        <div className="px-2 pb-1 text-[10px] uppercase tracking-[0.18em] text-white/50">
          View
        </div>
        {CAMERA_PRESETS.map((preset) => {
          const isActive = activePresetId === preset.id;
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
        <div className="text-white/50">
          Live train markers · drag to rotate · scroll to zoom
        </div>
      </div>

      <Canvas
        camera={{
          position: getPreset(INITIAL_PRESET)?.position ?? [55, 45, 55],
          fov: 50,
          near: 0.1,
          far: 1000,
        }}
        shadows
      >
        {/* Slightly bluer-than-black background. Fog blends to a very
            close color so the horizon doesn't hard-edge against the
            background — the world appears to recede into haze instead
            of clipping at fog far. */}
        <color attach="background" args={["#0a1124"]} />
        <fog attach="fog" args={["#13203a", 65, 260]} />

        {/* Hemisphere fill: cool sky-blue from above, warm tungsten from
            below. Replicates how light actually behaves at street level —
            blue zenith bouncing off pavement that's been warmed by sodium
            lamps. Keeps everything from looking flat-lit. */}
        <hemisphereLight color="#9bc1ff" groundColor="#ffba85" intensity={0.45} />
        {/* Slightly reduced ambient since hemi now does most of the fill.
            Without this, low-detail surfaces (rails undersides, ramp
            backs) bleach out. */}
        <ambientLight intensity={0.22} />
        {/* Warmer key light + a hair more intensity so the rail metallic
            highlights pop. Position is the same off-axis "afternoon"
            angle that's been working well for the cutaway. */}
        <directionalLight
          color="#fff5e6"
          position={[20, 30, 10]}
          intensity={1.15}
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
        <PlatformLights platforms={model.platforms} origin={model.center} />
        <PlatformLabels platforms={model.platforms} origin={model.center} />
        <Stairs stairs={model.stairs} origin={model.center} />
        <Entrances entrances={model.entrances} origin={model.center} />
        <LiveTrains platforms={model.platforms} origin={model.center} />

        <OrbitControls
          makeDefault
          enableDamping
          minDistance={5}
          maxDistance={200}
          target={getPreset(INITIAL_PRESET)?.target ?? [0, -8, 0]}
          // The user grabbing the camera always wins over an in-flight tween.
          // Clearing the highlight + tween target stops CameraRig dead and
          // hands control back without the camera fighting the user's drag.
          onStart={() => {
            setActivePresetId("");
            setTweenTarget(null);
          }}
        />

        <CameraRig active={tweenTarget} />

        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3b82f6"]} />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
