#!/usr/bin/env node
/**
 * Build a slim 3D station model from raw OSM data.
 *
 * Reads:
 *   data/stations/<id>.config.json      (level→depth map, platform line overrides)
 *   public/stations/<id>.osm.json       (raw Overpass response)
 *
 * Writes:
 *   public/stations/<id>.station3d.json (StationModel JSON; see lib/station3d/types.ts)
 *
 * Usage:
 *   node scripts/build-station-3d.mjs <stationId>
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseLevels(levelTag) {
  // OSM level tags can be "-2", "0", or "-2;-1" (range/multi).
  if (levelTag === undefined || levelTag === null) return [];
  return String(levelTag)
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

function depthFor(level, levelToDepthM) {
  const key = String(level);
  if (Object.prototype.hasOwnProperty.call(levelToDepthM, key)) {
    return levelToDepthM[key];
  }
  // Fall back to a linear extrapolation: -4m per level below 0.
  return level >= 0 ? 0 : level * 4;
}

function nodeId(el) {
  return `${el.type}/${el.id}`;
}

function geometryToPolyline(el) {
  if (Array.isArray(el.geometry)) {
    return el.geometry
      .filter((g) => typeof g.lat === "number" && typeof g.lon === "number")
      .map((g) => ({ lat: g.lat, lon: g.lon }));
  }
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return [{ lat: el.lat, lon: el.lon }];
  }
  return [];
}

function isPlatform(tags) {
  return tags?.railway === "platform" || tags?.public_transport === "platform";
}

function classify(el, ctx) {
  const tags = el.tags ?? {};
  const out = {
    platform: false,
    track: false,
    stairs: false,
    elevator: false,
    entrance: false,
  };
  if (isPlatform(tags) && el.type === "way") out.platform = true;
  if (tags.railway === "subway" && el.type === "way") out.track = true;
  if (tags.highway === "steps" && el.type === "way") out.stairs = true;
  if (tags.highway === "elevator") out.elevator = true;
  if (tags.railway === "subway_entrance" && el.type === "node") out.entrance = true;
  return out;
}

function makeBbox(elements) {
  const bbox = { minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 };
  for (const el of elements) {
    const points = geometryToPolyline(el);
    for (const p of points) {
      if (p.lat < bbox.minLat) bbox.minLat = p.lat;
      if (p.lat > bbox.maxLat) bbox.maxLat = p.lat;
      if (p.lon < bbox.minLon) bbox.minLon = p.lon;
      if (p.lon > bbox.maxLon) bbox.maxLon = p.lon;
    }
  }
  return bbox;
}

async function main() {
  const stationId = process.argv[2];
  if (!stationId) {
    console.error("Usage: node scripts/build-station-3d.mjs <stationId>");
    process.exit(1);
  }

  const configPath = path.join(ROOT, "data", "stations", `${stationId}.config.json`);
  const osmPath = path.join(ROOT, "public", "stations", `${stationId}.osm.json`);
  const outPath = path.join(ROOT, "public", "stations", `${stationId}.station3d.json`);

  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const osm = JSON.parse(await fs.readFile(osmPath, "utf8"));

  const levelToDepthM = config.levelToDepthM ?? {};
  const platformOverrides = config.platformOverrides ?? {};

  const platforms = [];
  const tracks = [];
  const stairs = [];
  const elevators = [];
  const entrances = [];
  let unclassifiedCount = 0;

  for (const el of osm.elements ?? []) {
    const tags = el.tags ?? {};
    const id = nodeId(el);
    const kind = classify(el);

    if (kind.platform) {
      const levels = parseLevels(tags.level);
      // Surface bus stops also use public_transport=platform but lack a level
      // tag. Skip them — we only want underground subway platforms.
      if (levels.length === 0) {
        unclassifiedCount++;
        continue;
      }
      const level = levels[0];
      const polyline = geometryToPolyline(el);
      if (polyline.length < 2) continue;
      const override = platformOverrides[id] ?? {};
      platforms.push({
        id,
        level,
        depthM: depthFor(level, levelToDepthM),
        line: override.line,
        routes: override.routes,
        name: tags.name ?? undefined,
        polyline,
      });
    } else if (kind.track) {
      const levels = parseLevels(tags.level ?? tags.layer);
      const level = levels[0] ?? -1;
      const polyline = geometryToPolyline(el);
      if (polyline.length < 2) continue;
      tracks.push({
        id,
        level,
        depthM: depthFor(level, levelToDepthM),
        tunnel: tags.tunnel === "yes",
        polyline,
      });
    } else if (kind.stairs) {
      const levels = parseLevels(tags.level);
      // We need at least two distinct levels to have a real connector.
      if (levels.length < 2) continue;
      const sorted = [...levels].sort((a, b) => b - a); // high → low
      const fromLevel = sorted[0];
      const toLevel = sorted[sorted.length - 1];
      if (fromLevel === toLevel) continue;
      const polyline = geometryToPolyline(el);
      if (polyline.length < 2) continue;
      stairs.push({
        id,
        fromLevel,
        toLevel,
        fromDepthM: depthFor(fromLevel, levelToDepthM),
        toDepthM: depthFor(toLevel, levelToDepthM),
        polyline,
      });
    } else if (kind.elevator) {
      const levels = parseLevels(tags.level);
      const polyline = geometryToPolyline(el);
      if (polyline.length === 0) continue;
      elevators.push({
        id,
        levels: levels.length > 0 ? [...new Set(levels)].sort((a, b) => b - a) : [0],
        position: polyline[0],
      });
    } else if (kind.entrance) {
      const polyline = geometryToPolyline(el);
      if (polyline.length === 0) continue;
      const entrance = {
        id,
        position: polyline[0],
      };
      if (tags.wheelchair) entrance.wheelchair = tags.wheelchair;
      if (tags.ref) entrance.ref = tags.ref;
      entrances.push(entrance);
    } else {
      unclassifiedCount++;
    }
  }

  const allFeatureElements = [...platforms, ...tracks, ...stairs, ...elevators, ...entrances]
    .flatMap((f) => (Array.isArray(f.polyline) ? [{ geometry: f.polyline }] : f.position ? [{ geometry: [f.position] }] : []))
    .map((g) => ({ geometry: g.geometry }));

  const bbox = makeBbox(
    allFeatureElements.length > 0
      ? allFeatureElements
      : [{ geometry: [config.center] }]
  );

  const model = {
    id: config.id,
    name: config.name,
    center: config.center,
    bbox,
    levelToDepthM,
    platforms,
    tracks,
    stairs,
    elevators,
    entrances,
    unclassifiedCount,
    generatedAt: new Date().toISOString(),
  };

  await fs.writeFile(outPath, JSON.stringify(model, null, 2), "utf8");

  console.log(`✓ Built ${path.relative(ROOT, outPath)}`);
  console.log(`  platforms: ${platforms.length}`);
  console.log(`  tracks:    ${tracks.length}`);
  console.log(`  stairs:    ${stairs.length}`);
  console.log(`  elevators: ${elevators.length}`);
  console.log(`  entrances: ${entrances.length}`);
  console.log(`  unclassified: ${unclassifiedCount}`);
}

main().catch((err) => {
  console.error("✗", err);
  process.exit(1);
});
