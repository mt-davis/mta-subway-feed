#!/usr/bin/env node
/**
 * Fetch raw OSM data for a station from the Overpass API and save it
 * verbatim under public/stations/<id>.osm.json.
 *
 * Usage:
 *   node scripts/fetch-station-osm.mjs <stationId>
 *
 * The station id must match a config file at data/stations/<id>.config.json
 * which provides center.lat / center.lon / radiusM.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

function buildQuery(lat, lon, radiusM) {
  // We deliberately query both railway=platform (older schema) and
  // public_transport=platform (newer schema) so we don't miss platforms.
  return `
[out:json][timeout:90];
(
  node(around:${radiusM},${lat},${lon})[railway=subway_entrance];
  way(around:${radiusM},${lat},${lon})[railway=platform];
  node(around:${radiusM},${lat},${lon})[railway=platform];
  way(around:${radiusM},${lat},${lon})[public_transport=platform];
  node(around:${radiusM},${lat},${lon})[public_transport=platform];
  way(around:${radiusM},${lat},${lon})[railway=subway];
  way(around:${radiusM},${lat},${lon})[indoor];
  way(around:${radiusM},${lat},${lon})[highway=steps];
  way(around:${radiusM},${lat},${lon})[highway=elevator];
  node(around:${radiusM},${lat},${lon})[highway=elevator];
  node(around:${radiusM},${lat},${lon})[railway=station];
  node(around:${radiusM},${lat},${lon})[public_transport=station];
);
out geom;
`.trim();
}

async function postQuery(endpoint, query) {
  const body = new URLSearchParams({ data: query });
  const res = await fetch(endpoint, {
    method: "POST",
    body,
    headers: {
      "User-Agent": "subway-app-station3d/0.1 (https://github.com/mt-davis/mta-subway-feed)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} from ${endpoint}`);
  }
  return res.text();
}

async function fetchWithFallback(query) {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`→ POST ${endpoint}`);
      return await postQuery(endpoint, query);
    } catch (err) {
      console.warn(`  ${endpoint} failed: ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("all Overpass endpoints failed");
}

async function main() {
  const stationId = process.argv[2];
  if (!stationId) {
    console.error("Usage: node scripts/fetch-station-osm.mjs <stationId>");
    process.exit(1);
  }

  const configPath = path.join(ROOT, "data", "stations", `${stationId}.config.json`);
  const raw = await fs.readFile(configPath, "utf8");
  const config = JSON.parse(raw);

  const { lat, lon } = config.center ?? {};
  const radiusM = config.radiusM ?? 200;
  if (typeof lat !== "number" || typeof lon !== "number") {
    throw new Error(`config ${configPath} is missing center.lat / center.lon`);
  }

  const query = buildQuery(lat, lon, radiusM);
  const text = await fetchWithFallback(query);

  // Validate JSON before writing.
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.elements)) {
    throw new Error("Overpass response missing `elements` array");
  }

  const outDir = path.join(ROOT, "public", "stations");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${stationId}.osm.json`);
  await fs.writeFile(outPath, JSON.stringify(parsed, null, 2), "utf8");

  console.log(
    `✓ Wrote ${parsed.elements.length} elements to ${path.relative(ROOT, outPath)}`
  );
}

main().catch((err) => {
  console.error("✗", err);
  process.exit(1);
});
