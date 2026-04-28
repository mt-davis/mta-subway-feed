export interface CameraPreset {
  id: string;
  label: string;
  description: string;
  position: [number, number, number];
  target: [number, number, number];
}

/**
 * Named camera positions for the 3D station view. Coordinates are in local
 * meters (the same coordinate system PlatformSlabs and Tracks use, with the
 * station center at the origin and Y up).
 *
 * Picked by hand for Union Square: the IRT Lex platforms run roughly
 * NW-SE through the origin at level -2; the BMT Canarsie L runs roughly
 * E-W at level -3, slightly south. Presets aim to make each line easy to
 * read at a glance.
 */
export const CAMERA_PRESETS: CameraPreset[] = [
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
    description: "Plan view from directly above",
    // 0.001 z avoids OrbitControls' gimbal lock when looking straight down.
    position: [0, 90, 0.001],
    target: [0, 0, 0],
  },
  {
    id: "lex",
    label: "Lex (4/5/6)",
    description: "Angled view focused on the IRT Lexington level (-2)",
    position: [35, -1, 35],
    target: [0, -10, 0],
  },
  {
    id: "canarsie",
    label: "Canarsie (L)",
    description: "Side view of the deep L line at level -3",
    position: [0, -10, 45],
    target: [0, -16, 0],
  },
];

export function getPreset(id: string): CameraPreset | undefined {
  return CAMERA_PRESETS.find((p) => p.id === id);
}
