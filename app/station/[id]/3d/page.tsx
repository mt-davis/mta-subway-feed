import fs from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import type { StationModel } from "@/lib/station3d/types";
import StationScene from "./StationScene";

async function loadStation(id: string): Promise<StationModel | null> {
  // Restrict to a slug-safe id so we never path-traverse out of /public/stations.
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  const filePath = path.join(
    process.cwd(),
    "public",
    "stations",
    `${id}.station3d.json`
  );
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as StationModel;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const model = await loadStation(id);
  if (!model) return { title: "Station not found" };
  return {
    title: `${model.name} — 3D Station View`,
    description: `Interactive 3D view of ${model.name} platforms, tracks, and stairs.`,
  };
}

export default async function StationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const model = await loadStation(id);
  if (!model) notFound();
  return <StationScene model={model} />;
}
