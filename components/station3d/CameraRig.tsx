"use client";

import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CameraPreset } from "@/lib/station3d/cameraPresets";

// Minimum distance (in world meters) we have to be from the target before we
// declare the tween "done". Below ~0.5m the perspective change isn't visible
// at this scene's typical distances, and stopping early keeps damping from
// fighting the rest of the frame budget.
const EPSILON = 0.5;

// Per-frame lerp factor. 0.12 gives a ~280ms 90% settle at 60 fps, which
// reads as "deliberate but snappy" — slow enough to communicate "here's
// where you're going", fast enough that you don't feel like you're waiting.
const LERP_RATE = 0.12;

/**
 * Smoothly tweens the active camera + OrbitControls target toward a preset.
 *
 * Lives inside <Canvas>. Reading `controls` off useThree relies on
 * <OrbitControls makeDefault /> in the parent (drei publishes the controls
 * instance to R3F state when makeDefault is set, so any component in the
 * tree can grab it without ref drilling).
 *
 * Setting `active` to null cancels an in-flight tween (used when the user
 * starts dragging — we don't want our lerp fighting their input).
 */
export function CameraRig({ active }: { active: CameraPreset | null }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as
    | { target: THREE.Vector3; update: () => void }
    | undefined;

  const targetPos = useRef(new THREE.Vector3());
  const targetLook = useRef(new THREE.Vector3());
  const animating = useRef(false);

  useEffect(() => {
    if (!active) {
      animating.current = false;
      return;
    }
    targetPos.current.set(...active.position);
    targetLook.current.set(...active.target);
    animating.current = true;
  }, [active]);

  useFrame(() => {
    if (!animating.current || !controls) return;

    camera.position.lerp(targetPos.current, LERP_RATE);
    controls.target.lerp(targetLook.current, LERP_RATE);
    controls.update();

    if (
      camera.position.distanceTo(targetPos.current) < EPSILON &&
      controls.target.distanceTo(targetLook.current) < EPSILON
    ) {
      // Snap exactly so floating-point drift doesn't accumulate across
      // many tweens.
      camera.position.copy(targetPos.current);
      controls.target.copy(targetLook.current);
      controls.update();
      animating.current = false;
    }
  });

  return null;
}
