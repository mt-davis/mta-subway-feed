/**
 * Palette for the 3D station view.
 * Line keys come from data/stations/<id>.config.json platformOverrides.line.
 */
export const LINE_COLOR: Record<string, string> = {
  lex: "#00933C", // 4/5/6 — IRT Lexington Ave green
  broadway: "#FCCC0A", // N/Q/R/W — BMT Broadway yellow
  canarsie: "#A7A9AC", // L — BMT Canarsie gray
};

export const PLATFORM_FALLBACK_COLOR = "#9CA3AF";
export const TRACK_COLOR = "#475569";
export const STAIRS_COLOR = "#f59e0b";
export const ENTRANCE_COLOR = "#3b82f6";
