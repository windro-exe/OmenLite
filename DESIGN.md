# OmenLite — Design System

Locked system for the web UI in `ui/`. Every screen and component reads this file first.
Where a generic rule (or a model default) disagrees with this file, this file wins.
Sources: study of butter.video, why.zero.university, otsuka-air.jp (REA + computed styles), Apple HIG
(Materials / Liquid Glass, Dark Mode, Motion), and the two research reports in `Documents/`
(Anthropic frontend-design skill, Emil Kowalski, Rauno Freiberg, Paco Coursey, Vercel guidelines, Raycast, Linear).

## 1. Concept

**An instrument, not a dashboard.** Each screen is one lit physical object on a matte carbon stage —
a heat core, a fan dial, a keyboard, a boost light. Everything else is quiet, small and monospaced.
Light carries meaning (temperature, power, colour you painted); it is never decoration.

Feel: calm, exact, expensive. Fast to respond, slow to settle.

## 2. Layout

- Window 1240×820, frameless. Title strip 44px (drag area, window buttons, live mode word).
- **One subject per screen, 65–75% of the stage.** Max 3 component groups visible per screen.
- Secondary readings sit at the stage edges as mono label + value lockups. No boxes around them.
- Settings-like lists: one flush list, rows split by hairlines `rgba(255,255,255,0.06)`. Never one card per setting.
- Navigation: a single floating glass dock, bottom-centre, 5 icons. It is the only glass on screen.
- 4px grid. Micro spacing tight (label→value 4–6px); macro spacing open (stage padding 48px+).

## 3. Colour (OKLCH, dark only)

| Token | Value | Use |
|---|---|---|
| `canvas` | `oklch(0.13 0.004 260)` | window background |
| `stage` | `oklch(0.155 0.005 260)` | recessed area the subject sits in (optional) |
| `raise-1` | `oklch(0.19 0.007 260)` | controls, segmented track |
| `raise-2` | `oklch(0.23 0.009 260)` | hover / pressed well, popovers |
| `hairline` | `oklch(1 0 0 / 0.06)` | dividers, control perimeter |
| `specular` | `oklch(1 0 0 / 0.09)` | 1px top-edge highlight on raised controls |
| `red` | `oklch(0.63 0.24 27)` (#FF1E27) | **signal only** |
| `amber` | `oklch(0.80 0.15 72)` | heat warning 80–84 °C |
| text | white at 0.94 / 0.64 / 0.42 / 0.24 | primary / secondary / tertiary / disabled |

**Red budget ≤ 5% of pixels.** Red appears only for: the active state (selected mode, active dial arc,
boost on), the control being manipulated, and ≥ 85 °C. Normal telemetry is white. No other hues —
except colours the user paints on the keyboard, which are content, not UI.

Depth = lightness steps + specular top edge. No drop shadows on dark surfaces except one soft
shadow under floating layers (dock, popovers, dialogs).

## 4. Type

- **Geist** (display + UI) and **Geist Mono** (units, axis ticks, small labels, live counters). Bundled, no CDN.
- Banned faces: Inter, Roboto, Arial, Open Sans, Space Grotesk.
- Weights 400 for display, 500 for UI labels. Never 700 for numbers.
- Scale (px): 11 mono label · 12 caption · 13 body · 15 subhead · 22 screen title · 40 secondary metric · 96–160 hero metric.
- Hero numerals: weight 400, tracking −0.045em, line-height 0.9, `tabular-nums`.
- Units (°C, RPM, W) hang outside the numeral's optical centre (absolute, top 0.15em, mono 11px, text-tertiary).
- Mono labels: 11px, 500, tracking +0.06em, text-tertiary, sentence case or lower case. **Not** an ALL-CAPS eyebrow above every heading.

## 5. Shape

- Concentric radii: `inner = max(0, outer − padding)`.
- Tokens: dock 22 (padding 6 → items 16) · control group 12 (padding 4 → pill 8) · keycap 6 · kbd tag 4 · dial/thumbs full.
- Never the same radius on parent and child.

## 6. Material

- **Glass** (dock only; temporarily also the dial thumb while dragging): `rgba(22,23,28,0.72)`,
  `backdrop-filter: blur(18px) saturate(140%)`, `inset 0 1px 0 rgba(255,255,255,0.14)`. Max one
  backdrop-filter layer per viewport.
- **Raised control**: `raise-1` fill, `inset 0 1px 0 specular`, `1px hairline` perimeter.
- **Light**: subjects emit light as static radial gradients (no `filter: blur` on large areas), dithered by
  a 64px noise tile at ~3% opacity to kill banding. Light intensity/colour is bound to data.

## 7. Motion

| Token | Value | Use |
|---|---|---|
| `ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | press release, popovers, tooltips |
| `ease-house` | `cubic-bezier(0.2, 0.715, 0.205, 0.99)` | the signature: subject entrances, light changes, mode sweeps |
| `ease-morph` | `cubic-bezier(0.77, 0, 0.175, 1)` | on-screen indicator / clip-path moves |
| `d-press` | 140ms | `:active` scale 0.97 |
| `d-micro` | 180ms | tooltip, popover, state swap |
| `d-morph` | 260ms | segmented indicator, clip-path |
| `d-house` | 600ms | subject light / colour settling |

**Frequency gate** (decide before animating):
- 100+/day or keyboard-initiated (screen switch, Ctrl+K, shortcuts) → no movement; ≤ 120ms opacity only.
- Tens/day (mode change, toggles) → ≤ 260ms.
- Occasional (boost, apply graphics mode) → up to 600ms, may use the house curve.
- Rare/celebration (boost engaged) → one 800ms moment allowed.

Rules:
- Animate only `transform`, `opacity`, `clip-path`. Never `transition: all`, never layout properties.
- Direct manipulation (dial, paint, hold) uses springs with **zero bounce**: drag `stiffness 300 damping 30`; telemetry smoothing `stiffness 120 damping 22`.
- Entrances start at scale ≥ 0.96, never 0. Exits faster and smaller than entrances.
- Segmented controls use the clip-path exclusion technique (Paco Coursey): text colour flips exactly under the pill.
- State swaps inside one control (icon → check, number → number) may use a transient 2px blur (≤ 180ms, `filter: none` at rest).
- Only loops allowed: fan glyph rotation (real RPM) and the boost light while boost is on (real state). All loops pause when hidden.
- `prefers-reduced-motion`: drop translate/scale, keep ≤ 150ms opacity.

## 8. Interaction (desktop-native feel)

- `cursor: default` everywhere; `grab/grabbing` only on dial and keyboard paint; `ns-resize` while dragging the dial.
- `user-select: none`, `overscroll-behavior: none`, `color-scheme: dark`, no visible scrollbars.
- Hover states only under `@media (hover: hover) and (pointer: fine)`; no hover lift on containers.
- `:active` → scale 0.97 on every pressable.
- Focus: `:focus-visible` only, 1.5px ring in `red` at 2px offset (box-shadow, follows radius).
- Hit targets ≥ 24×24.
- Dial: pointer capture, **vertical drag** (−Δy × 0.6 → value), wheel ±100 RPM, arrows ±100 / Shift ±500, soft resistance at ends.
- Feedback < 100ms for every action; BIOS calls > 1s show a pending state in place.
- Results appear where the action happened (no toasts for success except Undo-able actions).

## 9. Copy

- Tool voice, user vocabulary: "Fan speed", "Keyboard", "Performance". Never "WMI", "BIOS command".
- Full short sentences for help text, placed where it applies.
- Banned: marketing verbs (supercharge, unleash), `→` on buttons, `A · B · C` meta strings,
  `WORD — fragment` labels, decorative `01/02/03`, single-word colour/italic accents in headings.

## 10. Screens

| Screen | Subject (65–75%) | Edge readings | Play |
|---|---|---|---|
| Home | **Heat core**: radial light whose size/colour follows CPU °C; hero numeral in front | GPU °C, fans RPM, load %, power W (mono lockups) | light breathes with real load; click core → Performance |
| Performance | **Fan dial** with the 4 modes as stops on its outer ring | live fan RPM ×2, current mode text | drag/scroll the dial; pick a mode on the ring; Auto/Manual/Max segmented |
| Lighting | **Keyboard object** lit from below on the stage | zone names under each region, brush swatch | paint by drag; underglow shows result; Undo |
| Boost | **Boost light**: one circular button that is a light source | the 4 real steps as a quiet list; Clean-up as one hairline row | hold → light builds to a bloom → steps tick |
| Settings | none — flush hairline list | — | Graphics mode (confirm dialog), autostart, about |

## 11. Banned (build-failing)

Card grids of equal boxes · cards in cards · icon-in-tinted-circle + title + 2 lines · uniform grey
borders · neon glow on static containers · drop shadows on dark content · multi-hue accents ·
purple/blue gradients or blurred colour blobs · Inter/Roboto/Space Grotesk · weight-700 numbers ·
ALL-CAPS eyebrows above every heading · `transition: all` · `ease-in` on entrances · `scale(0)` ·
hover lift / hover scale on containers · pulsing status dots · staggered entrances on utility lists ·
bouncy springs on utility controls · `cursor: pointer` · text selection · visible scrollbars ·
more than one backdrop-filter on screen.

## 12. Review checklist (run on screenshots before shipping)

1. Squint: is there exactly one thing your eye lands on per screen?
2. Count red pixels: only on active state / manipulated control / ≥ 85 °C?
3. Any box around something that isn't interactive? Remove it.
4. Any two nested elements with the same radius?
5. Numbers: Geist 400, tabular, units hung outside?
6. Every pressable: hover (fine pointer), active 0.97, focus-visible ring?
7. Screen switch and Ctrl+K: instant?
8. Does any animation run that isn't tied to real state or a user action?
9. Copy: any banned pattern or system jargon?
10. Hidden to tray: all loops and telemetry paused?
