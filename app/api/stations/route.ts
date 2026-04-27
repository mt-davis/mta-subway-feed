import { NextResponse } from 'next/server';
import { getStations } from '@/lib/gtfs-static';
import type { Station } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StationsApiResponse {
  stations: Station[];
}

export async function GET() {
  try {
    const stops = await getStations();
    const stations: Station[] = stops.map((s) => ({
      id: s.stopId,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
    }));

    const body: StationsApiResponse = { stations };
    return NextResponse.json(body, {
      headers: {
        // Stations are essentially static; refresh only when GTFS static drops.
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('Error building stations response:', err);
    return NextResponse.json(
      { error: 'Failed to load stations' },
      { status: 500 },
    );
  }
}
