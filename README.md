# SVG Editor

A serverless, browser-based SVG editor. Open `svg-editor.html` directly in a
modern browser — no build step, no server, no dependencies.

## Files

| File | Role |
|------|------|
| `svg-editor.html` | Markup and layout (topbar, palette, canvas, inspector, source panel) |
| `svg-editor.css`  | Styling |
| `svg-editor.js`   | All editor logic — state, rendering, input handling, parsing |
| `LICENSE`         | AGPL-3.0 license text |
| `README.md`       | This file |

## Layout

```
+----------------------------------------------------------------------+
| topbar:  Tool | Precision | Grid + Spacing | Canvas (x y w h aspect  |
|          Preset) | Undo Redo Clear Delete                            |
+----------+-------------------------------------+---------------------+
| palette  | rulers + canvas (SVG)               | inspector           |
|  Tools   |  +-----------+--------------------+ |  - id / type        |
|  Add     |  | ruler-corn|  ruler-top         | |  - geometry         |
|  Edit    |  +-----------+--------------------+ |  - fill / stroke    |
|  Arrange |  | ruler-left|  canvas content    | |  - text / path /    |
|          |  |           |                    | |    points / image   |
|          |  +-----------+--------------------+ |                     |
|          +-------------------------------------+                     |
|          | source: <svg>...</svg>              |                     |
|          | [Open] [Save] [Apply]               |                     |
+----------+-------------------------------------+---------------------+
```

## Element types

- **Rectangle** (`<rect>`) — x, y, width, height.
- **Ellipse** (`<ellipse>`) — cx, cy, rx, ry.
- **Circle** (`<circle>`) — cx, cy, r.
- **Line** (`<line>`) — two endpoints `(x1, y1)` and `(x2, y2)`. Drag the
  endpoint dots to move them individually. Lines don't get bbox scale
  handles (the bbox collapses to a line when the segment is axis-aligned).
- **Text** (`<text>`) — position handle at the baseline start. Inspector
  controls for content, font-size (integer arrow stepping, decimal typing
  OK), and font-family.
- **Polyline / Polygon** (`<polyline>` / `<polygon>`) — list of vertex
  points. Click a vertex dot to select it; drag to move. The inspector
  lists every vertex with x/y inputs, insert-after, and delete. Polygon
  closes the path implicitly; polyline doesn't.
- **Path** (`<path>`) — full SVG path data (`M L H V C S Q T A Z`). Each
  segment is parsed into `{cmd, params}`. Click an endpoint dot to select
  a segment, then drag its endpoint or control points. The inspector
  lists every segment with a cmd dropdown (rendered in upper or lower
  case to match the segment), an abs/rel toggle (preserves visual
  geometry across the conversion), per-parameter inputs, insert-after,
  and delete.
- **Image** (`<image>`) — file or URL reference. The Image tool opens a
  file picker on canvas click and writes
  `href="<prefix><filename>"` (default prefix `image/`); the picked file
  itself is rendered in the editor via an in-session `blob:` URL so you
  see it while you work without bloating the saved SVG. Inspector
  controls: source display, Prefix input (sticky across adds), *From
  file…*, *From URL…*, Align (nine alignments plus `none (stretch)`),
  Mode (`meet` / `slice`).

All types except line also expose 8 bbox scale handles (4 corners +
4 edge midpoints). Drag a corner to scale around the opposite corner;
hold **Shift** to lock the aspect ratio. Drag an edge midpoint to scale
on one axis only. Precision is intentionally not snapped during a
scale drag — use **Snap to precision** afterward if you want.

## Precision

Top-bar dropdown chooses snap precision (`int`, `0.1`, `0.01`, `0.001`,
`0.0001`, or `free`). It governs arrow-key stepping in numeric inputs and the
snap applied while dragging. Typing into a numeric field is not snapped —
the user controls precision when they type. Font-size arrows step by 1 by
convention; the field still accepts decimals.

## Grid and rulers

Toggle the **Grid** checkbox to display dashed gray gridlines and a pair of
HTML rulers along the top and left edges of the canvas. The slider sets the
spacing (5–100 units). Rulers use `getScreenCTM()` so ticks align with the
actual viewBox coordinates even when the SVG is letterboxed.

## Canvas size

The topbar exposes the SVG viewBox: **x**, **y** (origin) and **w**, **h**
(dimensions). The **aspect** toggle locks the W/H ratio at the moment it's
activated — subsequent edits to W compute H (or vice versa) to preserve
that ratio; toggling off discards it. The **Preset…** dropdown applies a
common size (16² through 1920×1080, plus A4 portrait at 595×842).
Existing elements are *not* rescaled when the canvas resizes — their
coordinates stay put. Canvas changes go on the undo stack.

## Source panel

The bottom textarea shows live SVG source generated from the canvas state.
Editing the textarea enables **Apply**, which parses and replaces the
canvas. **Open** and **Save** use the File System Access API where
available (Chrome/Edge) and fall back to `prompt()` + Blob download
otherwise.

Validation messages on Apply include line numbers where possible, e.g.
`Line 4: element <polygon> not supported`.

## Editing helpers

Palette "Edit" section:

- **Duplicate** — copies the selected element with a +10/+10 offset
  (filename-href preserved for images; segment data deep-cloned for paths
  and polylines/polygons).
- **Snap to precision** — rounds the selected element's geometry,
  stroke-width, font-size, path-segment params, and polyline/polygon
  vertex coordinates to the active precision.

Palette "Arrange" section (z-order — `state.elements` order = paint order):

- **To front** / **Forward** / **Backward** / **To back** move the
  selected element through the stack. Keyboard: `Ctrl+]` forward,
  `Ctrl+[` backward, `Ctrl+Shift+]` to front, `Ctrl+Shift+[` to back.

Topbar:

- **Undo** / **Redo** with keyboard `Ctrl+Z` (undo), `Ctrl+Shift+Z` or
  `Ctrl+Y` (redo). Snapshots cover element edits and canvas viewBox
  changes (selection is intentionally not snapshotted, so a pure
  click-to-select doesn't pollute the history). Continuous edits — typed
  values, color picker drags, opacity slider — coalesce via a 500 ms
  debounce into one undo step. Drags push one snapshot at pointerup.

Keys:

- **Delete** / **Backspace** removes the current selection.
- **Esc** exits add-mode or deselects.

## License

Copyright (c) 2026 James Brogan

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or (at
your option) any later version.

This program is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public
License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
