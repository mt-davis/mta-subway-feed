import { NextResponse } from 'next/server';
import { getShapes } from '@/lib/gtfs-static';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const features = await getShapes();

    const geojson = {
      type: 'FeatureCollection' as const,
      features,
    };

    return NextResponse.json(geojson, {
      headers: {
        // Client can cache for 1 hour; shapes are essentially static
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('Error building shapes GeoJSON:', err);
    return NextResponse.json(
      { error: 'Failed to load route shapes' },
      { status: 500 },
    );
  }
}
