# Design System — NYC Subway Live

## Product Context
- **What this is:** Real-time visualization of every active train in the NYC subway system
- **Who it's for:** Commuters, transit nerds, tourists, and engineers who want to see the system as it runs
- **Space/industry:** Transit / civic tech / data visualization
- **Project type:** Data-dense web app (map-first dashboard)
- **Positioning:** Better and faster than the official MTA app

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian
- **Decoration level:** Minimal — the map IS the decoration
- **Mood:** Serious infrastructure software. Function-first, data-dense, clean but not sterile. The MTA's visual language is iconic; we execute it with more craft than they do.
- **Reference sites:** MTA's own subway signage system (Helvetica, circular bullets, bold colors)

## Typography
- **Display/Hero:** Geist Sans — clean, contemporary, excellent for interfaces
- **Body:** Geist Sans — same face, no need for a second
- **UI/Labels:** Geist Sans
- **Data/Tables:** Geist Sans with `font-variant-numeric: tabular-nums` — train counts, timestamps must align like a departure board
- **Code:** Geist Mono
- **Loading:** Bundled via Next.js (`next/font/local`)
- **Scale:**
  - Caption: 11px
  - Body: 12px
  - Labels: 14px
  - H3: 16px
  - H2: 18-20px
  - Display: 32px

## Color

### Approach: Inherited + Restrained
The MTA line colors ARE the accent palette. No additional brand color. Every chrome element is neutral to let the map dominate.

### MTA Line Colors (immutable)
These are official and must not be modified:
| Lines | Hex |
|-------|-----|
| 1, 2, 3 | `#EE352E` |
| 4, 5, 6 | `#00933C` |
| 7 | `#B933AD` |
| A, C, E | `#0039A6` |
| B, D, F, M | `#FF6319` |
| G | `#6CBE45` |
| J, Z | `#996633` |
| L | `#A7A9AC` |
| N, Q, R, W | `#FCCC0A` |
| S | `#808183` |
| SIR | `#003DA5` |

### Neutrals (cool grays)
| Token | Light | Dark |
|-------|-------|------|
| `--background` | `#ffffff` | `#030712` |
| `--surface` | `#f9fafb` | `#111827` |
| `--surface-elevated` | `#ffffff` | `#1f2937` |
| `--border` | `rgba(15, 23, 42, 0.08)` | `rgba(255, 255, 255, 0.08)` |
| `--text` | `#0b1220` | `#f9fafb` |
| `--text-muted` | `#6b7280` | `#9ca3af` |
| `--text-subtle` | `#9ca3af` | `#6b7280` |

### Semantic
| Token | Hex | Usage |
|-------|-----|-------|
| `--fresh` | `#22c55e` | Data < 30s old, "Updated Ns ago" indicator |
| `--stale` | `#f59e0b` | Data > 60s old |
| `--error` | `#ef4444` | Feed failure, connection error |

### Dark Mode Strategy
- Background goes to near-black (`#030712`)
- Surfaces use dark grays (`#111827`, `#1f2937`)
- MTA colors remain unchanged — they have enough contrast against dark backgrounds
- Text flips to light (`#f9fafb`)

## Spacing
- **Base unit:** 4px
- **Density:** Compact — data-dense is the nature of the product
- **Scale:**
  - 2xs: 2px
  - xs: 4px
  - sm: 8px
  - md: 12px (note: not 16, keeping tighter)
  - lg: 16px
  - xl: 24px
  - 2xl: 32px
  - 3xl: 48px

## Layout
- **Approach:** Data-dense dashboard
- **Structure:** Header (fixed) → Map (fills viewport) → Overlays (stats, filters)
- **Max content width:** N/A — map is full-bleed
- **Border radius:**
  - sm: 4px (inputs, small controls)
  - md: 8px (cards, panels)
  - lg: 12px (modals, sheets)
  - full: 9999px (bullets, badges, pills)

## Motion
- **Approach:** Minimal-functional with signature moves
- **Philosophy:** Motion serves comprehension. The live data IS the motion.

### Standard Transitions
- **State changes (hover, focus):** 150ms ease-out
- **Panel open/close:** 200ms ease-out (enter), 150ms ease-in (exit)
- **Theme crossfade:** 300ms — tile layer fades, no remount

### Signature Animations
1. **Stopped train pulse-ring:** 1.8s ease-out infinite — radiating ring that fades as it expands
2. **Moving train spin-border:** 1.2s linear infinite — subtle rotating border arc
3. **"Updated Ns ago" ticker:** 1s interval — the live heartbeat of the app

### Easing
- Enter: `ease-out`
- Exit: `ease-in`
- Move: `ease-in-out`

### Durations
| Category | Duration |
|----------|----------|
| Micro (hover, focus) | 50-150ms |
| Short (state change) | 150-250ms |
| Medium (panel, modal) | 250-400ms |
| Long (page transition) | 400-700ms |

## Component Patterns

### Train Markers
- 28×28px circle with 2px white border (dark theme) or dark border (light theme)
- Route letter centered, 11px bold
- Outer shadow ring for visibility on map
- Hover: scale(1.3), elevated shadow, z-index bump

### Cluster Markers
- Sizes: sm (32px), md (38px), lg (46px), xl (54px)
- Count displayed in center, tabular-nums
- Colored rim based on dominant route in cluster

### Delta Badges
- ▲ (green) / ▼ (red) with numeric change
- 10px font, inline with counts
- Hidden when delta is 0

### Status Indicators
- 6-8px dot with semantic color
- Positioned inline with label

### Buttons
- Primary: `--text` background, `--bg` text — inverts in dark mode
- Secondary: `--surface` background, 1px border
- Ghost: transparent, muted text

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-27 | Initial design system created | Created by /design-consultation based on "better than the MTA app" positioning |
| 2026-04-27 | No accent color | MTA bullet colors provide all the accent needed; adding more dilutes them |
| 2026-04-27 | Tabular numerics everywhere | Train counts, timestamps must align like a departure board — serious infrastructure feel |
| 2026-04-27 | 4px base spacing (not 8px) | Data-dense app needs compact spacing; 8px felt too loose |
| 2026-04-27 | Keep existing marker animations | pulse-ring and spin-border are distinctive and communicate state effectively |
