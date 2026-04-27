# NYC Subway Live

> Every active train in the NYC subway system, on a map, in real time. No login, no API key, no app store.

A zero-friction, single-page web app that fetches all eight MTA GTFS-realtime feeds, snaps each train to its line, and renders the system as it runs — with smooth interpolation between updates and per-line filtering.

![Stack](https://img.shields.io/badge/Next.js-16-black) ![React](https://img.shields.io/badge/React-19-61dafb) ![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## Why this exists
I did it for Fun! 😁

Most "subway tracker" experiences make you pick a line, pick a station, and squint at a list of arrival times. That's fine if you already know which train you want. But there's a different question worth answering at a glance:

> **What is the system doing right now?**

That's the question this app answers. You open it, you see every train, color-coded, moving. You can filter to one line, see how many trains are running, and watch the network breathe.

## Who it's for

| Audience | What they get |
|---|---|
| **Commuters** | A quick "is the L moving?" check before heading to the station. |
| **Transit nerds** | A live, full-system view that almost nothing else on the open web offers. |
| **Tourists & visitors** | A friendlier mental model than a static line map — see where trains actually are. |
| **Engineers** | A working reference for consuming GTFS-RT, animating between sparse fixes, and rendering ~400 moving markers without dropping frames. |

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). That's the entire setup. **No API key needed** — MTA's realtime feeds are public.

```bash
npm run build && npm run start    # production
npm run lint                      # ESLint
```

---

## What's on screen

Everything below is in the live build today.

### Map & data
- **All 8 MTA realtime feeds**, fetched in parallel server-side, decoded from Protocol Buffers, deduplicated, and returned as a single JSON payload
- **Subway line shapes** drawn underneath as GeoJSON, so trains visibly travel *along* their routes
- **~400 trains animated continuously** via a `requestAnimationFrame` loop that interpolates each train's position along its line between data fetches — so motion feels live even though backing data updates every 30 s
- **Marker clustering at low zoom** so the map doesn't melt into a blob of bullets when you zoom out
- **Map clamped to NYC**: hard `maxBounds` and `minZoom` so the map can't drift into the Atlantic or zoom out to a globe view

### UI
- **Header** with live train count, last-updated freshness indicator (green / amber / red dot), and a 1-second ticking "Updated 12s ago" label
- **Per-line filter** with official MTA bullet colors; click a bullet to isolate, shift-click to multi-select equivalents (1/2/3 toggle as a group)
- **Stats panel** (desktop, right) with per-line counts and **delta arrows** showing trains entering/leaving service since the last fetch
- **Mobile bottom sheet** with Lines / Stats tabs — same data, thumb-friendly
- **Legend** that reuses the exact same DOM/CSS as live markers — so what you see in the legend is exactly what's on the map
- **Theme toggle** (light / dark) following system preference, persisted across reloads; tile basemap crossfades on switch
- **Custom zoom controls** at top-right for users without a scroll wheel (touchpads, tablets, accessibility)
- **Click any train** for route, current status (Stopped / Approaching / In transit), current stop, and next stop

### Reliability
- **Graceful degradation** when one of the eight feeds fails (e.g., MTA returns 503): the other seven still render, with a non-blocking error banner
- **No client-side API keys**: realtime fetches happen server-side in `/api/trains`, so the MTA endpoints are never exposed to the browser even if they later require auth

---

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React 19, dynamic-imported Leaflet client-only)   │
│                                                             │
│   ┌─────────────────┐   poll every 30s   ┌───────────────┐  │
│   │  SubwayMap      │ ─────────────────▶ │  /api/trains  │  │
│   │  + RouteFilter  │                    │   (Node)      │  │
│   │  + Stats / Sheet│                    └───────┬───────┘  │
│   └────────┬────────┘                            │          │
│            │                                     │          │
│   ┌────────▼────────┐  one-time on load  ┌───────▼───────┐  │
│   │  MapComponent   │ ─────────────────▶ │  /api/shapes  │  │
│   │  (Leaflet)      │                    │  /api/stations│  │
│   │  + Turf.js      │                    └───────┬───────┘  │
│   └─────────────────┘                            │          │
└──────────────────────────────────────────────────┼──────────┘
                                                   │
                                  ┌────────────────▼─────────────────┐
                                  │  MTA: GTFS-RT (binary protobuf)  │
                                  │       GTFS static (zip → cached) │
                                  └──────────────────────────────────┘
```

**Three API routes, all server-side:**
- `GET /api/trains` — fans out to all 8 GTFS-RT feeds, decodes, normalizes, returns ~400 train positions. `cache: no-store`.
- `GET /api/stations` — parses `stops.txt` from the MTA static GTFS zip. Cached 1h client + 1d SWR.
- `GET /api/shapes` — parses `shapes.txt` into route GeoJSON. Cached 1h client + 1d SWR.

**On the client:**
- Each train is rendered as a Leaflet `divIcon` (HTML, not SVG), so we get cheap CSS animations and DOM-level click targets.
- Between fetches, every visible train's position is recomputed every animation frame via `@turf/turf`'s `nearestPointOnLine` + `along`, snapping the marker to the actual route geometry.
- Markers that are clustered or culled off-screen are skipped in the RAF loop — so the cost scales with what's *visible*, not what *exists*.

---

## Architecture

```
app/
  page.tsx                       Server entry; renders <SubwayMap />
  layout.tsx                     Theme provider + meta
  globals.css                    Tailwind base + marker keyframes
  api/
    trains/route.ts              Fan-out + decode of all 8 GTFS-RT feeds
    stations/route.ts            stops.txt → JSON
    shapes/route.ts              shapes.txt → GeoJSON
lib/
  gtfs-static.ts                 Zip fetch + parse + 1h memo cache
  route-colors.ts                Official MTA per-line colors
  theme.ts                       System / light / dark preference store
  useDelta.ts                    Hook: tracks numeric trend, auto-clears
  types.ts                       TrainPosition, Station, API responses
components/
  SubwayMap.tsx                  Top-level shell + Header + responsive layout
  MapComponent.tsx               Leaflet map, clustering, RAF animation
  RouteFilter.tsx                Per-line bullet toggles (desktop rail)
  StatsPanel.tsx                 Per-line counts + total-delta badges
  MobileSheet.tsx                Bottom sheet with Lines/Stats tabs
  Legend.tsx                     Marker key (reuses live marker CSS)
  DeltaBadge.tsx                 ▲5 / ▼2 trend pills
  ZoomControls.tsx               Custom +/− buttons (top-right)
  ThemeToggle.tsx                Light/dark switch
```

---

## Engineering decisions worth knowing

A few non-obvious calls I'd want a new contributor to understand before changing them.

| Decision | Why |
|---|---|
| **30-second polling, not WebSocket / SSE** | MTA's GTFS-RT feeds update every ~15–30 s. A push channel would just relay the same staleness with more infrastructure. |
| **Smooth animation client-side, not server-pushed positions** | The server returns *fixes*; the client interpolates between them. This means the perceived motion is independent of network jitter, and the server stays cacheable in principle. |
| **Leaflet `divIcon` over SVG markers** | Per-marker DOM lets us animate via CSS `transform` and pulse-rings without a render loop touching React. ~400 markers stay at 60 fps. |
| **`removeOutsideVisibleBounds: true` on the cluster group** | Off-screen markers are removed from the DOM. Combined with a "skip if no DOM element" guard in the RAF loop, hidden trains cost nothing. |
| **TileLayer URL is *swapped*, not remounted, on theme change** | Earlier code remounted via `key={theme}`, which blanked the map for a frame. Letting react-leaflet propagate the prop change uses Leaflet's built-in fade. |
| **Map hard-clamped to NYC bounds** | There are no trains in the Atlantic. Letting the user pan/zoom there is a footgun, not a feature. |

---

## Known limitations & roadmap

**Honest about what's not there yet:**

- **No trip prediction** — the app shows where trains *are*, not when they'll *arrive at your station*. That's a different (harder, well-served) product.
- **No service alerts** — the GTFS-RT alerts feed exists; integrating it (e.g., dimming a line that has a service change) is the most-wanted next feature.
- **No accessibility audit** — keyboard nav and screen-reader labels are present but not formally tested against WCAG.
- **Bus, LIRR, and Metro-North are out of scope** — by design, for now. The MTA feeds exist; adding them is mostly a configuration change in `app/api/trains/route.ts`.
- **No analytics or telemetry** — the app does not phone home. (Whether to add anonymized error reporting is an open question.)

**Plausible next moves**, roughly in priority order:

1. **Service alerts overlay** — pull from the alerts feed, dim affected line shapes, surface in the per-line filter
2. **Station-level view** — click a station, see next arrivals (this *is* the 80% commuter use case)
3. **PWA / offline shell** — cache the map shell + last fetched fixes so the app loads instantly on a flaky platform
4. **Permalinks for filtered views** — `/?lines=L,G` for sharing
5. **Buses** — different feed shape, but same problem

---

## Data sources & attribution

- **Realtime feeds**: [MTA GTFS-Realtime](https://api.mta.info/#/subwayRealTimeFeeds) — public, no key required, binary Protocol Buffers
- **Static schedule data**: [MTA GTFS](https://transitfeeds.com/p/mta/79) — `stops.txt` and `shapes.txt`, parsed and cached for 1 hour
- **Map tiles**: [CARTO basemaps](https://carto.com/basemaps/) (`light_all` and `dark_all`) — public, key-free

This project is not affiliated with or endorsed by the MTA.

## Stack

- **Next.js 16** (App Router, server routes, dynamic imports)
- **React 19** with `useSyncExternalStore` for the live "Updated Ns ago" clock
- **TypeScript 5**
- **Tailwind CSS 4**
- **Leaflet 1.9** + `react-leaflet` 5 + `leaflet.markercluster`
- **Turf.js 7** for line-snapping and along-line position math
- **`gtfs-realtime-bindings`** for protobuf decoding
- **JSZip** for extracting `stops.txt` / `shapes.txt` from the static GTFS bundle

## License

MIT. Use it, fork it, learn from it.
