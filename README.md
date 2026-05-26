# SVG Editor

A serverless, browser-based SVG editor. Open `svg-editor.html` directly in a
modern browser — no build step, no server, no dependencies.

## Files

| File | Role |
|------|------|
| `svg-editor.html` | Markup and layout (topbar, palette, canvas, inspector, source panel) |
| `svg-editor.css`  | Styling |
| `svg-editor.js`   | All editor logic — state, rendering, input handling, parsing |

## Layout

```
+-------------------------------------------------------------+
| topbar:  Tool | Precision | Grid | Spacing |   Clear Delete |
+---------+---------------------------------+-------------------+
| palette | canvas (SVG)                    | inspector         |
|  Tools  |                                 |  - geometry       |
|  Add    |                                 |  - fill / stroke  |
|  Edit   |                                 |  - text / path    |
|         +---------------------------------+                   |
|         | source: <svg>...</svg>          |                   |
|         | [Open] [Save] [Apply]           |                   |
+---------+---------------------------------+-------------------+
```

## Element types

- **Rectangle** — `<rect>` with 8-point resize handles.
- **Ellipse / Circle** — center + cardinal handles.
- **Line** — two endpoint handles.
- **Text** — position handle; content / font-size / font-family in the inspector.
- **Path** — full SVG path data (`M L H V C S Q T A Z`). Each segment is parsed
  into `{cmd, params}`; click an endpoint dot to select a segment, then drag its
  endpoint or control points. The inspector lists every segment with a cmd
  dropdown, abs/rel toggle (preserves geometry), insert-after, and delete.

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

## Source panel

The bottom textarea shows live SVG source generated from the canvas state.
Editing the textarea enables **Apply**, which parses and replaces the
canvas. **Open** and **Save** use the File System Access API where
available (Chrome/Edge) and fall back to `prompt()` + Blob download
otherwise.

Validation messages on Apply include line numbers where possible, e.g.
`Line 4: element <polygon> not supported`.

## Editing helpers

- **Duplicate** — copies the selected element with a +10/+10 offset.
- **Snap to precision** — rounds the selected element's geometry,
  stroke-width, font-size, and path-segment params to the active precision.
- **Delete** key removes the current selection.
- **Esc** exits add-mode or deselects.
