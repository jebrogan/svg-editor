(() => {
'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HANDLE_SIZE = 8;

const canvas = document.getElementById('canvas');
const content = document.getElementById('content');
const handlesLayer = document.getElementById('handles');
const palette = document.getElementById('palette');
const sourceEl = document.getElementById('source');
const sourceStatus = document.getElementById('source-status');
const inspectorEmpty = document.getElementById('inspector-empty');
const inspectorBody = document.getElementById('inspector-body');
const toolNameEl = document.getElementById('tool-name');

const state = {
    tool: 'select',
    elements: [],
    selectedId: null,
    selectedSegmentIdx: null, // index into path.attrs.segments when a path is selected
    nextId: 1,
    precision: 1, // 0..4 (decimal places) or 'free'
    grid: { enabled: false, spacing: 20 },
    canvas: { x: 0, y: 0, width: 800, height: 600 }, // SVG viewBox
    canvasAspectLocked: false,
    canvasLockedAspect: null,
    lastImagePrefix: 'image/', // sticky default for new <image> href prefixes
};

// ===== Per-type behavior =====
const TYPES = {
    rect: {
        defaults: () => ({ x: 0, y: 0, width: 120, height: 80, fill: '#4f9dff', stroke: '#000000', 'stroke-width': 1, 'fill-opacity': 1 }),
        atPoint: (p) => ({ x: p.x - 60, y: p.y - 40 }),
        geomFields: ['x', 'y', 'width', 'height'],
        bbox: (a) => ({ x: a.x, y: a.y, width: a.width, height: a.height }),
        handles: (a) => {
            const { x, y, width: w, height: h } = a;
            return [
                { name: 'nw', x: x,         y: y,         kind: 'nw' },
                { name: 'n',  x: x + w/2,  y: y,         kind: 'n'  },
                { name: 'ne', x: x + w,    y: y,         kind: 'ne' },
                { name: 'e',  x: x + w,    y: y + h/2,  kind: 'e'  },
                { name: 'se', x: x + w,    y: y + h,    kind: 'se' },
                { name: 's',  x: x + w/2,  y: y + h,    kind: 's'  },
                { name: 'sw', x: x,        y: y + h,    kind: 'sw' },
                { name: 'w',  x: x,        y: y + h/2,  kind: 'w'  },
            ];
        },
        applyHandle: (a, name, p) => {
            let x1 = a.x, y1 = a.y, x2 = a.x + a.width, y2 = a.y + a.height;
            if (name.includes('w')) x1 = p.x;
            if (name.includes('e')) x2 = p.x;
            if (name.includes('n')) y1 = p.y;
            if (name.includes('s')) y2 = p.y;
            a.x = Math.min(x1, x2);
            a.y = Math.min(y1, y2);
            a.width = Math.abs(x2 - x1);
            a.height = Math.abs(y2 - y1);
        },
        translate: (a, dx, dy) => { a.x += dx; a.y += dy; },
        scaleAround: (a, anchor, sx, sy) => {
            a.x = anchor.x + (a.x - anchor.x) * sx;
            a.y = anchor.y + (a.y - anchor.y) * sy;
            a.width *= sx;
            a.height *= sy;
            if (a.width < 0)  { a.x += a.width;  a.width  = -a.width;  }
            if (a.height < 0) { a.y += a.height; a.height = -a.height; }
        },
    },

    ellipse: {
        defaults: () => ({ cx: 0, cy: 0, rx: 60, ry: 40, fill: '#4f9dff', stroke: '#000000', 'stroke-width': 1, 'fill-opacity': 1 }),
        atPoint: (p) => ({ cx: p.x, cy: p.y }),
        geomFields: ['cx', 'cy', 'rx', 'ry'],
        bbox: (a) => ({ x: a.cx - a.rx, y: a.cy - a.ry, width: 2 * a.rx, height: 2 * a.ry }),
        handles: (a) => [
            { name: 'center', x: a.cx,        y: a.cy,        kind: 'center' },
            { name: 'e',      x: a.cx + a.rx, y: a.cy,        kind: 'e' },
            { name: 'w',      x: a.cx - a.rx, y: a.cy,        kind: 'w' },
            { name: 'n',      x: a.cx,        y: a.cy - a.ry, kind: 'n' },
            { name: 's',      x: a.cx,        y: a.cy + a.ry, kind: 's' },
        ],
        applyHandle: (a, name, p) => {
            if (name === 'center') { a.cx = p.x; a.cy = p.y; }
            else if (name === 'e' || name === 'w') a.rx = Math.max(0, Math.abs(p.x - a.cx));
            else if (name === 'n' || name === 's') a.ry = Math.max(0, Math.abs(p.y - a.cy));
        },
        translate: (a, dx, dy) => { a.cx += dx; a.cy += dy; },
        scaleAround: (a, anchor, sx, sy) => {
            a.cx = anchor.x + (a.cx - anchor.x) * sx;
            a.cy = anchor.y + (a.cy - anchor.y) * sy;
            a.rx = Math.abs(a.rx * sx);
            a.ry = Math.abs(a.ry * sy);
        },
    },

    circle: {
        defaults: () => ({ cx: 0, cy: 0, r: 50, fill: '#4f9dff', stroke: '#000000', 'stroke-width': 1, 'fill-opacity': 1 }),
        atPoint: (p) => ({ cx: p.x, cy: p.y }),
        geomFields: ['cx', 'cy', 'r'],
        bbox: (a) => ({ x: a.cx - a.r, y: a.cy - a.r, width: 2 * a.r, height: 2 * a.r }),
        handles: (a) => [
            { name: 'center', x: a.cx,       y: a.cy,       kind: 'center' },
            { name: 'e',      x: a.cx + a.r, y: a.cy,       kind: 'e' },
            { name: 'w',      x: a.cx - a.r, y: a.cy,       kind: 'w' },
            { name: 'n',      x: a.cx,       y: a.cy - a.r, kind: 'n' },
            { name: 's',      x: a.cx,       y: a.cy + a.r, kind: 's' },
        ],
        applyHandle: (a, name, p) => {
            if (name === 'center') { a.cx = p.x; a.cy = p.y; }
            else a.r = Math.max(0, Math.hypot(p.x - a.cx, p.y - a.cy));
        },
        translate: (a, dx, dy) => { a.cx += dx; a.cy += dy; },
        scaleAround: (a, anchor, sx, sy) => {
            a.cx = anchor.x + (a.cx - anchor.x) * sx;
            a.cy = anchor.y + (a.cy - anchor.y) * sy;
            a.r = Math.abs(a.r * (Math.abs(sx) + Math.abs(sy)) / 2);
        },
    },

    line: {
        defaults: () => ({ x1: 0, y1: 0, x2: 100, y2: 0, stroke: '#000000', 'stroke-width': 2, fill: 'none', 'fill-opacity': 1 }),
        atPoint: (p) => ({ x1: p.x - 50, y1: p.y, x2: p.x + 50, y2: p.y }),
        geomFields: ['x1', 'y1', 'x2', 'y2'],
        bbox: (a) => ({
            x: Math.min(a.x1, a.x2),
            y: Math.min(a.y1, a.y2),
            width:  Math.abs(a.x2 - a.x1),
            height: Math.abs(a.y2 - a.y1),
        }),
        handles: (a) => [
            { name: 'p1', x: a.x1, y: a.y1, kind: 'endpoint' },
            { name: 'p2', x: a.x2, y: a.y2, kind: 'endpoint' },
        ],
        applyHandle: (a, name, p) => {
            if (name === 'p1') { a.x1 = p.x; a.y1 = p.y; }
            else { a.x2 = p.x; a.y2 = p.y; }
        },
        translate: (a, dx, dy) => { a.x1 += dx; a.y1 += dy; a.x2 += dx; a.y2 += dy; },
        scaleAround: (a, anchor, sx, sy) => {
            a.x1 = anchor.x + (a.x1 - anchor.x) * sx;
            a.y1 = anchor.y + (a.y1 - anchor.y) * sy;
            a.x2 = anchor.x + (a.x2 - anchor.x) * sx;
            a.y2 = anchor.y + (a.y2 - anchor.y) * sy;
        },
    },

    text: {
        defaults: () => ({ x: 0, y: 0, content: 'Text', 'font-size': 24, 'font-family': 'sans-serif', fill: '#000000', stroke: 'none', 'stroke-width': 0, 'fill-opacity': 1 }),
        atPoint: (p) => ({ x: p.x, y: p.y }),
        geomFields: ['x', 'y'],
        bbox: null, // computed from DOM
        handles: (a) => [
            { name: 'pos', x: a.x, y: a.y, kind: 'endpoint' },
        ],
        applyHandle: (a, name, p) => {
            if (name === 'pos') { a.x = p.x; a.y = p.y; }
        },
        translate: (a, dx, dy) => { a.x += dx; a.y += dy; },
        scaleAround: (a, anchor, sx, sy) => {
            a.x = anchor.x + (a.x - anchor.x) * sx;
            a.y = anchor.y + (a.y - anchor.y) * sy;
            const f = Math.abs((sx + sy) / 2);
            if (typeof a['font-size'] === 'number') a['font-size'] = a['font-size'] * f;
        },
    },

    image: {
        defaults: () => ({ x: 0, y: 0, width: 100, height: 100, href: '', preserveAspectRatio: 'xMidYMid meet' }),
        atPoint: (p) => ({ x: p.x, y: p.y }),
        geomFields: ['x', 'y', 'width', 'height'],
        bbox: (a) => ({ x: a.x, y: a.y, width: a.width, height: a.height }),
        handles: () => [],
        applyHandle: () => {},
        translate: (a, dx, dy) => { a.x += dx; a.y += dy; },
        scaleAround: (a, anchor, sx, sy) => {
            a.x = anchor.x + (a.x - anchor.x) * sx;
            a.y = anchor.y + (a.y - anchor.y) * sy;
            a.width *= sx;
            a.height *= sy;
            if (a.width < 0)  { a.x += a.width;  a.width  = -a.width;  }
            if (a.height < 0) { a.y += a.height; a.height = -a.height; }
        },
    },

    polyline: {
        defaults: () => ({ fill: 'none', stroke: '#000000', 'stroke-width': 2, 'fill-opacity': 1, points: [] }),
        atPoint: (p) => ({ points: [[p.x, p.y], [p.x + 60, p.y + 40], [p.x + 120, p.y]] }),
        geomFields: [],
        bbox: null, // use DOM getBBox
        handles: () => [],
        applyHandle: () => {},
        translate: (a, dx, dy) => {
            for (const pt of (a.points || [])) { pt[0] += dx; pt[1] += dy; }
        },
        scaleAround: (a, anchor, sx, sy) => {
            for (const pt of (a.points || [])) {
                pt[0] = anchor.x + (pt[0] - anchor.x) * sx;
                pt[1] = anchor.y + (pt[1] - anchor.y) * sy;
            }
        },
    },

    polygon: {
        defaults: () => ({ fill: '#4f9dff', stroke: '#000000', 'stroke-width': 1, 'fill-opacity': 1, points: [] }),
        atPoint: (p) => ({ points: [[p.x, p.y - 50], [p.x + 50, p.y + 30], [p.x - 50, p.y + 30]] }),
        geomFields: [],
        bbox: null,
        handles: () => [],
        applyHandle: () => {},
        translate: (a, dx, dy) => {
            for (const pt of (a.points || [])) { pt[0] += dx; pt[1] += dy; }
        },
        scaleAround: (a, anchor, sx, sy) => {
            for (const pt of (a.points || [])) {
                pt[0] = anchor.x + (pt[0] - anchor.x) * sx;
                pt[1] = anchor.y + (pt[1] - anchor.y) * sy;
            }
        },
    },

    path: {
        defaults: () => ({
            fill: 'none',
            stroke: '#000000',
            'stroke-width': 2,
            'fill-opacity': 1,
            segments: [],
        }),
        atPoint: (p) => ({
            segments: [
                { cmd: 'M', params: [p.x, p.y] },
                { cmd: 'l', params: [100, 0] },
            ],
        }),
        geomFields: [],
        bbox: null, // use DOM getBBox
        handles: () => [], // handled specially in renderHandles
        applyHandle: () => {}, // handled specially in pointer logic
        translate: (a, dx, dy) => {
            const segs = a.segments || [];
            for (let i = 0; i < segs.length; i++) {
                const seg = segs[i];
                const upper = seg.cmd.toUpperCase();
                const isAbs = (seg.cmd === upper);
                // First moveto is treated as absolute regardless of case
                if (i === 0 && upper === 'M') {
                    seg.params[0] += dx; seg.params[1] += dy;
                    continue;
                }
                if (!isAbs) continue;
                switch (upper) {
                    case 'M': case 'L': case 'T':
                        seg.params[0] += dx; seg.params[1] += dy; break;
                    case 'H':
                        seg.params[0] += dx; break;
                    case 'V':
                        seg.params[0] += dy; break;
                    case 'C':
                        seg.params[0] += dx; seg.params[1] += dy;
                        seg.params[2] += dx; seg.params[3] += dy;
                        seg.params[4] += dx; seg.params[5] += dy; break;
                    case 'S': case 'Q':
                        seg.params[0] += dx; seg.params[1] += dy;
                        seg.params[2] += dx; seg.params[3] += dy; break;
                    case 'A':
                        seg.params[5] += dx; seg.params[6] += dy; break;
                }
            }
        },
        scaleAround: (a, anchor, sx, sy) => {
            const segs = a.segments || [];
            for (let i = 0; i < segs.length; i++) {
                const seg = segs[i];
                const upper = seg.cmd.toUpperCase();
                const isAbs = (seg.cmd === upper);
                const isFirstM = (i === 0 && upper === 'M');
                const treatAbs = isAbs || isFirstM;
                const scX = v => treatAbs ? (anchor.x + (v - anchor.x) * sx) : (v * sx);
                const scY = v => treatAbs ? (anchor.y + (v - anchor.y) * sy) : (v * sy);
                switch (upper) {
                    case 'M': case 'L': case 'T':
                        seg.params[0] = scX(seg.params[0]);
                        seg.params[1] = scY(seg.params[1]); break;
                    case 'H':
                        seg.params[0] = scX(seg.params[0]); break;
                    case 'V':
                        seg.params[0] = scY(seg.params[0]); break;
                    case 'C':
                        seg.params[0] = scX(seg.params[0]); seg.params[1] = scY(seg.params[1]);
                        seg.params[2] = scX(seg.params[2]); seg.params[3] = scY(seg.params[3]);
                        seg.params[4] = scX(seg.params[4]); seg.params[5] = scY(seg.params[5]); break;
                    case 'S': case 'Q':
                        seg.params[0] = scX(seg.params[0]); seg.params[1] = scY(seg.params[1]);
                        seg.params[2] = scX(seg.params[2]); seg.params[3] = scY(seg.params[3]); break;
                    case 'A':
                        seg.params[0] = Math.abs(seg.params[0] * sx);
                        seg.params[1] = Math.abs(seg.params[1] * sy);
                        seg.params[5] = scX(seg.params[5]);
                        seg.params[6] = scY(seg.params[6]); break;
                }
            }
        },
    },
};

// ===== Path data helpers =====
const PATH_CMD_PARAMS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const PATH_PARAM_LABELS = {
    M: ['x', 'y'], L: ['x', 'y'], H: ['x'], V: ['y'],
    C: ['x1', 'y1', 'x2', 'y2', 'x', 'y'],
    S: ['x2', 'y2', 'x', 'y'],
    Q: ['x1', 'y1', 'x', 'y'],
    T: ['x', 'y'],
    A: ['rx', 'ry', 'rot', 'large', 'sweep', 'x', 'y'],
    Z: [],
};
const PATH_TOKEN_RE = /[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

function parsePathData(d) {
    if (!d) return [];
    const tokens = d.match(PATH_TOKEN_RE) || [];
    const segs = [];
    let i = 0;
    while (i < tokens.length) {
        const cmd = tokens[i++];
        if (!/^[a-zA-Z]$/.test(cmd)) {
            throw new Error(`expected path command, got "${cmd}"`);
        }
        const upper = cmd.toUpperCase();
        const n = PATH_CMD_PARAMS[upper];
        if (n === undefined) throw new Error(`unknown path command "${cmd}"`);
        if (n === 0) { segs.push({ cmd, params: [] }); continue; }
        let first = true;
        while (true) {
            if (i + n > tokens.length) throw new Error(`incomplete params for "${cmd}"`);
            const params = tokens.slice(i, i + n).map(Number);
            if (params.some(v => Number.isNaN(v))) {
                throw new Error(`non-numeric param for "${cmd}"`);
            }
            // After implicit M, subsequent param-tuples are L
            let effective = cmd;
            if (!first && upper === 'M') effective = (cmd === 'M') ? 'L' : 'l';
            segs.push({ cmd: effective, params });
            i += n;
            first = false;
            if (i >= tokens.length || /^[a-zA-Z]$/.test(tokens[i])) break;
        }
    }
    return segs;
}

// ===== polyline / polygon point helpers =====
const POINTS_TOKEN_RE = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

function parsePoints(str) {
    if (!str || !str.trim()) return [];
    const tokens = str.match(POINTS_TOKEN_RE) || [];
    if (tokens.length % 2 !== 0) throw new Error('odd number of coordinates');
    const pts = [];
    for (let i = 0; i < tokens.length; i += 2) {
        const x = parseFloat(tokens[i]);
        const y = parseFloat(tokens[i + 1]);
        if (Number.isNaN(x) || Number.isNaN(y)) throw new Error('non-numeric coordinate');
        pts.push([x, y]);
    }
    return pts;
}

function serializePoints(points) {
    return (points || [])
        .map(pt => formatPathNum(pt[0]) + ',' + formatPathNum(pt[1]))
        .join(' ');
}

function serializePathData(segs) {
    return (segs || []).map(s => {
        if (!s.params.length) return s.cmd;
        return s.cmd + ' ' + s.params.map(formatPathNum).join(' ');
    }).join(' ');
}

function formatPathNum(n) {
    if (typeof n !== 'number') return String(n);
    // Strip trailing zeros while keeping reasonable precision
    return Number(n.toFixed(6)).toString();
}

// Compute segment-by-segment { start, end, cp1, cp2 } for handle placement.
function pathPoints(segs) {
    const result = [];
    let cur = { x: 0, y: 0 };
    let sub = { x: 0, y: 0 };
    for (const seg of (segs || [])) {
        const upper = seg.cmd.toUpperCase();
        const rel = (seg.cmd !== upper);
        const start = { x: cur.x, y: cur.y };
        let end = { x: cur.x, y: cur.y };
        let cp1, cp2;
        const p = seg.params;
        switch (upper) {
            case 'M':
                end = rel ? { x: cur.x + p[0], y: cur.y + p[1] } : { x: p[0], y: p[1] };
                sub = { x: end.x, y: end.y };
                break;
            case 'L': case 'T':
                end = rel ? { x: cur.x + p[0], y: cur.y + p[1] } : { x: p[0], y: p[1] };
                break;
            case 'H':
                end = rel ? { x: cur.x + p[0], y: cur.y } : { x: p[0], y: cur.y };
                break;
            case 'V':
                end = rel ? { x: cur.x, y: cur.y + p[0] } : { x: cur.x, y: p[0] };
                break;
            case 'C':
                cp1 = rel ? { x: cur.x + p[0], y: cur.y + p[1] } : { x: p[0], y: p[1] };
                cp2 = rel ? { x: cur.x + p[2], y: cur.y + p[3] } : { x: p[2], y: p[3] };
                end = rel ? { x: cur.x + p[4], y: cur.y + p[5] } : { x: p[4], y: p[5] };
                break;
            case 'S':
                cp2 = rel ? { x: cur.x + p[0], y: cur.y + p[1] } : { x: p[0], y: p[1] };
                end = rel ? { x: cur.x + p[2], y: cur.y + p[3] } : { x: p[2], y: p[3] };
                break;
            case 'Q':
                cp1 = rel ? { x: cur.x + p[0], y: cur.y + p[1] } : { x: p[0], y: p[1] };
                end = rel ? { x: cur.x + p[2], y: cur.y + p[3] } : { x: p[2], y: p[3] };
                break;
            case 'A':
                end = rel ? { x: cur.x + p[5], y: cur.y + p[6] } : { x: p[5], y: p[6] };
                break;
            case 'Z':
                end = { x: sub.x, y: sub.y };
                break;
        }
        result.push({ start, end, cp1, cp2 });
        cur = end;
    }
    return result;
}

// Convert a segment between absolute/relative, preserving the path's visual geometry.
function toggleSegmentAbs(segments, idx) {
    const seg = segments[idx];
    const upper = seg.cmd.toUpperCase();
    const isAbs = (seg.cmd === upper);
    const calc = pathPoints(segments);
    const start = calc[idx].start;
    const sx = start.x, sy = start.y;
    const sign = isAbs ? -1 : 1;
    const p = seg.params.slice();
    switch (upper) {
        case 'M': case 'L': case 'T':
            p[0] += sign * sx; p[1] += sign * sy; break;
        case 'H':
            p[0] += sign * sx; break;
        case 'V':
            p[0] += sign * sy; break;
        case 'C':
            p[0] += sign * sx; p[1] += sign * sy;
            p[2] += sign * sx; p[3] += sign * sy;
            p[4] += sign * sx; p[5] += sign * sy; break;
        case 'S': case 'Q':
            p[0] += sign * sx; p[1] += sign * sy;
            p[2] += sign * sx; p[3] += sign * sy; break;
        case 'A':
            p[5] += sign * sx; p[6] += sign * sy; break;
        case 'Z': break;
    }
    seg.params = p;
    seg.cmd = isAbs ? seg.cmd.toLowerCase() : seg.cmd.toUpperCase();
}

// Default params for a freshly inserted segment of the given cmd, at currentPoint cur.
function defaultSegmentParams(cmd, cur) {
    const upper = cmd.toUpperCase();
    const rel = (cmd !== upper);
    if (rel) {
        switch (upper) {
            case 'M': case 'L': case 'T': return [50, 0];
            case 'H': return [50];
            case 'V': return [50];
            case 'C': return [25, -30, 75, -30, 100, 0];
            case 'S': case 'Q': return [50, -30, 100, 0];
            case 'A': return [40, 40, 0, 0, 0, 80, 0];
            case 'Z': return [];
        }
    }
    switch (upper) {
        case 'M': case 'L': case 'T': return [cur.x + 50, cur.y];
        case 'H': return [cur.x + 50];
        case 'V': return [cur.y + 50];
        case 'C': return [cur.x + 25, cur.y - 30, cur.x + 75, cur.y - 30, cur.x + 100, cur.y];
        case 'S': case 'Q': return [cur.x + 50, cur.y - 30, cur.x + 100, cur.y];
        case 'A': return [40, 40, 0, 0, 0, cur.x + 80, cur.y];
        case 'Z': return [];
    }
    return [];
}

// Apply a control-point drag to a specific param-slot pair (or single slot for H/V).
function applyPathHandle(segments, segIdx, kind, point) {
    const seg = segments[segIdx];
    const upper = seg.cmd.toUpperCase();
    const isAbs = (seg.cmd === upper);
    const start = pathPoints(segments)[segIdx].start;
    const setXY = (xi, yi) => {
        if (isAbs) {
            seg.params[xi] = point.x;
            seg.params[yi] = point.y;
        } else {
            seg.params[xi] = point.x - start.x;
            seg.params[yi] = point.y - start.y;
        }
    };
    const setX = (xi) => {
        seg.params[xi] = isAbs ? point.x : (point.x - start.x);
    };
    const setY = (yi) => {
        seg.params[yi] = isAbs ? point.y : (point.y - start.y);
    };
    if (kind === 'end') {
        switch (upper) {
            case 'M': case 'L': case 'T': setXY(0, 1); break;
            case 'H': setX(0); break;
            case 'V': setY(0); break;
            case 'C': setXY(4, 5); break;
            case 'S': case 'Q': setXY(2, 3); break;
            case 'A': setXY(5, 6); break;
            case 'Z': break;
        }
    } else if (kind === 'cp1') {
        if (upper === 'C' || upper === 'Q') setXY(0, 1);
    } else if (kind === 'cp2') {
        if (upper === 'C') setXY(2, 3);
        else if (upper === 'S') setXY(0, 1);
    }
}

const NUMERIC_ATTRS = new Set([
    'x','y','width','height','cx','cy','r','rx','ry',
    'x1','y1','x2','y2','stroke-width','fill-opacity','font-size'
]);

// ===== Undo / redo history =====
const HISTORY_MAX = 100;
const history = {
    stack: [],
    index: -1,
};

function takeSnapshot() {
    return {
        elements: JSON.parse(JSON.stringify(state.elements)),
        canvas: { ...state.canvas },
    };
}

function pushHistory() {
    if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
    }
    const snap = takeSnapshot();
    history.stack.length = history.index + 1;
    if (history.stack.length > 0) {
        const last = history.stack[history.stack.length - 1];
        if (JSON.stringify(last) === JSON.stringify(snap)) return;
    }
    history.stack.push(snap);
    if (history.stack.length > HISTORY_MAX) history.stack.shift();
    history.index = history.stack.length - 1;
    updateUndoButtons();
}

let _debounceTimer = null;
function pushHistoryDebounced(delay = 500) {
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
        _debounceTimer = null;
        pushHistory();
    }, delay);
}

function flushDebounce() {
    if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
        pushHistory();
    }
}

function restoreSnapshot(snap) {
    // Compatibility: older snapshots were just an array of elements.
    const elements = Array.isArray(snap) ? snap : (snap.elements || []);
    state.elements = JSON.parse(JSON.stringify(elements));
    if (!Array.isArray(snap) && snap.canvas) {
        state.canvas = { ...snap.canvas };
        applyCanvasViewBox();
    }
    // Validate selection
    if (state.selectedId && !findElement(state.selectedId)) {
        state.selectedId = null;
        state.selectedSegmentIdx = null;
    } else if (state.selectedId) {
        const el = findElement(state.selectedId);
        if (!el || el.type !== 'path') {
            state.selectedSegmentIdx = null;
        } else if (state.selectedSegmentIdx != null &&
                   !(el.attrs.segments && el.attrs.segments[state.selectedSegmentIdx])) {
            state.selectedSegmentIdx = null;
        }
    }
    segmentsBuiltSig = null;
    polyPointsBuiltSig = null;
    inspectorBuiltForId = null;
    render();
}

function undo() {
    if (history.index <= 0) return;
    flushDebounce();
    // After flush, index may have advanced; recheck.
    if (history.index <= 0) return;
    history.index--;
    restoreSnapshot(history.stack[history.index]);
    updateUndoButtons();
}

function redo() {
    if (history.index >= history.stack.length - 1) return;
    history.index++;
    restoreSnapshot(history.stack[history.index]);
    updateUndoButtons();
}

function updateUndoButtons() {
    const u = document.getElementById('btn-undo');
    const r = document.getElementById('btn-redo');
    if (u) u.disabled = (history.index <= 0);
    if (r) r.disabled = (history.index >= history.stack.length - 1);
}

// ===== Precision helpers =====
function precisionStep(prec) {
    if (prec === 'free') return 1;
    return Math.pow(10, -prec);
}

function roundTo(val, prec) {
    if (prec === 'free' || prec === null || prec === undefined) return val;
    if (typeof val !== 'number' || !Number.isFinite(val)) return val;
    const factor = Math.pow(10, prec);
    return Math.round(val * factor) / factor;
}

function formatNum(val, prec) {
    if (prec === 'free' || prec === null || prec === undefined) return String(val);
    return Number(val.toFixed(prec)).toString();
}

function snapGeom(el, prec) {
    if (prec === 'free') return;
    const def = TYPES[el.type];
    for (const f of def.geomFields) {
        if (typeof el.attrs[f] === 'number') {
            el.attrs[f] = roundTo(el.attrs[f], prec);
        }
    }
}

// Attach custom arrow-key behavior to a numeric input.
// opts: { getPrecision(), getStep(), onChange(val) }
function attachNumeric(input, opts) {
    input.step = 'any';
    input.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const prec = opts.getPrecision();
        const step = opts.getStep();
        const raw = parseFloat(input.value);
        const base = Number.isNaN(raw) ? 0 : roundTo(raw, prec);
        const next = roundTo(base + (e.key === 'ArrowUp' ? step : -step), prec);
        input.value = formatNum(next, prec);
        opts.onChange(next);
        pushHistory();
    });
    input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        if (!Number.isNaN(v)) {
            opts.onChange(v);
            pushHistoryDebounced();
        }
    });
}

// ===== Utility =====
function svgPoint(clientX, clientY) {
    const pt = canvas.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(canvas.getScreenCTM().inverse());
}

function nextId(type) {
    return `${type}-${state.nextId++}`;
}

function findElement(id) {
    return state.elements.find(e => e.id === id);
}

function toHex(color) {
    if (typeof color !== 'string') return '#000000';
    if (color === 'none' || !color) return '#000000';
    if (color.startsWith('#')) {
        if (color.length === 4) {
            return '#' + color.slice(1).split('').map(c => c + c).join('');
        }
        return color.slice(0, 7);
    }
    const tmp = document.createElement('div');
    tmp.style.color = color;
    document.body.appendChild(tmp);
    const rgb = getComputedStyle(tmp).color;
    document.body.removeChild(tmp);
    const m = rgb.match(/\d+/g);
    if (!m) return '#000000';
    const [r, g, b] = m.slice(0, 3).map(n => parseInt(n, 10));
    return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
}

function escapeAttr(v) {
    return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escapeText(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== DOM build =====
function createSvgNode(el) {
    const node = document.createElementNS(SVG_NS, el.type);
    node.setAttribute('data-editor-element', el.id);
    applyAttrs(node, el);
    return node;
}

function applyAttrs(node, el) {
    const a = el.attrs;
    if (el.type === 'text') {
        for (const k of ['x','y','font-size','font-family','fill','stroke','stroke-width','fill-opacity','stroke-dasharray']) {
            if (a[k] !== undefined && a[k] !== null && a[k] !== '') node.setAttribute(k, a[k]);
        }
        node.textContent = a.content ?? '';
        return;
    }
    if (el.type === 'path') {
        node.setAttribute('d', serializePathData(a.segments));
        for (const k of ['fill','stroke','stroke-width','fill-opacity','stroke-dasharray','stroke-linecap','stroke-linejoin']) {
            if (a[k] !== undefined && a[k] !== null && a[k] !== '') node.setAttribute(k, a[k]);
        }
        return;
    }
    if (el.type === 'polyline' || el.type === 'polygon') {
        node.setAttribute('points', serializePoints(a.points));
        for (const k of ['fill','stroke','stroke-width','fill-opacity','stroke-dasharray','stroke-linecap','stroke-linejoin']) {
            if (a[k] !== undefined && a[k] !== null && a[k] !== '') node.setAttribute(k, a[k]);
        }
        return;
    }
    if (el.type === 'image') {
        for (const k of ['x','y','width','height','preserveAspectRatio']) {
            if (a[k] !== undefined && a[k] !== null && a[k] !== '') node.setAttribute(k, a[k]);
        }
        // For rendering, prefer the in-session display URL (a blob: URL
        // attached when the user picked a local file) over the canonical
        // href so the image shows up even though the canonical href is a
        // bare filename relative to the eventual SVG location.
        const renderHref = a._displayHref || a.href;
        if (renderHref) node.setAttribute('href', renderHref);
        return;
    }
    for (const [k, v] of Object.entries(a)) {
        if (k === 'content') continue;
        if (v === undefined || v === null || v === '') continue;
        node.setAttribute(k, v);
    }
}

// ===== Rendering =====
function render() {
    while (content.firstChild) content.removeChild(content.firstChild);
    for (const el of state.elements) {
        content.appendChild(createSvgNode(el));
    }
    renderGrid();
    renderHandles();
    updateInspector();
    updateSource();
    updateToolUI();
}

function getViewBox() {
    const parts = (canvas.getAttribute('viewBox') || '0 0 800 600').split(/\s+/).map(parseFloat);
    return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
}

function renderGrid() {
    const g = document.getElementById('grid');
    clearChildren(g);
    if (!state.grid.enabled) return;
    const { x, y, w, h } = getViewBox();
    const sp = state.grid.spacing;
    if (!(sp > 0)) return;
    for (let gx = Math.ceil(x / sp) * sp; gx <= x + w; gx += sp) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('class', 'grid-line');
        line.setAttribute('x1', gx);
        line.setAttribute('y1', y);
        line.setAttribute('x2', gx);
        line.setAttribute('y2', y + h);
        g.appendChild(line);
    }
    for (let gy = Math.ceil(y / sp) * sp; gy <= y + h; gy += sp) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('class', 'grid-line');
        line.setAttribute('x1', x);
        line.setAttribute('y1', gy);
        line.setAttribute('x2', x + w);
        line.setAttribute('y2', gy);
        g.appendChild(line);
    }
}

function renderHtmlRulers() {
    const rulerTop = document.getElementById('ruler-top');
    const rulerLeft = document.getElementById('ruler-left');
    rulerTop.innerHTML = '';
    rulerLeft.innerHTML = '';
    if (!state.grid.enabled) return;
    const ctm = canvas.getScreenCTM();
    if (!ctm) return;
    const canvasRect = canvas.getBoundingClientRect();
    const { x, y, w, h } = getViewBox();
    const sp = state.grid.spacing;
    if (!(sp > 0)) return;
    const labelEvery = Math.max(1, Math.round(40 / sp));
    const pt = canvas.createSVGPoint();

    let i = 0;
    for (let gx = Math.ceil(x / sp) * sp; gx <= x + w; gx += sp, i++) {
        pt.x = gx; pt.y = y;
        const localX = pt.matrixTransform(ctm).x - canvasRect.left;
        const major = (i % labelEvery === 0);
        const tick = document.createElement('div');
        tick.className = 'ruler-tick' + (major ? ' major' : '');
        tick.style.left = localX + 'px';
        rulerTop.appendChild(tick);
        if (major) {
            const lbl = document.createElement('div');
            lbl.className = 'ruler-label';
            lbl.style.left = (localX + 2) + 'px';
            lbl.textContent = String(gx);
            rulerTop.appendChild(lbl);
        }
    }
    i = 0;
    for (let gy = Math.ceil(y / sp) * sp; gy <= y + h; gy += sp, i++) {
        pt.x = x; pt.y = gy;
        const localY = pt.matrixTransform(ctm).y - canvasRect.top;
        const major = (i % labelEvery === 0);
        const tick = document.createElement('div');
        tick.className = 'ruler-tick' + (major ? ' major' : '');
        tick.style.top = localY + 'px';
        rulerLeft.appendChild(tick);
        if (major) {
            const lbl = document.createElement('div');
            lbl.className = 'ruler-label';
            lbl.style.top = (localY + 1) + 'px';
            lbl.textContent = String(gy);
            rulerLeft.appendChild(lbl);
        }
    }
}

function bboxHandlePos(dir, bb) {
    const isE = dir.includes('e');
    const isW = dir.includes('w');
    const isN = dir.includes('n');
    const isS = dir.includes('s');
    return {
        x: isE ? bb.x + bb.width  : (isW ? bb.x : bb.x + bb.width / 2),
        y: isS ? bb.y + bb.height : (isN ? bb.y : bb.y + bb.height / 2),
    };
}

function bboxAnchor(dir, bb) {
    const opp = { n: 's', s: 'n', e: 'w', w: 'e' };
    let oppositeDir = '';
    for (const ch of dir) oppositeDir += opp[ch];
    return bboxHandlePos(oppositeDir, bb);
}

function renderHandles() {
    while (handlesLayer.firstChild) handlesLayer.removeChild(handlesLayer.firstChild);
    if (!state.selectedId) return;
    const el = findElement(state.selectedId);
    if (!el) return;
    const def = TYPES[el.type];

    const bb = computeBBox(el);
    if (bb) {
        const pad = 2;
        const outline = document.createElementNS(SVG_NS, 'rect');
        outline.setAttribute('class', 'selection-outline');
        outline.setAttribute('x', bb.x - pad);
        outline.setAttribute('y', bb.y - pad);
        outline.setAttribute('width', bb.width + 2 * pad);
        outline.setAttribute('height', bb.height + 2 * pad);
        handlesLayer.appendChild(outline);
    }

    // Bbox scale handles: shown for any element with a non-degenerate bbox.
    if (bb && bb.width > 0 && bb.height > 0) {
        for (const d of ['nw','n','ne','e','se','s','sw','w']) {
            const p = bboxHandlePos(d, bb);
            const sq = document.createElementNS(SVG_NS, 'rect');
            sq.setAttribute('class', `handle h-${d}`);
            sq.setAttribute('x', p.x - HANDLE_SIZE / 2);
            sq.setAttribute('y', p.y - HANDLE_SIZE / 2);
            sq.setAttribute('width', HANDLE_SIZE);
            sq.setAttribute('height', HANDLE_SIZE);
            sq.setAttribute('data-handle', 'scale-' + d);
            handlesLayer.appendChild(sq);
        }
    }

    if (el.type === 'path') {
        renderPathHandles(el);
        return;
    }
    if (el.type === 'polyline' || el.type === 'polygon') {
        renderPolyHandles(el);
        return;
    }

    // Per-type specialty handles (line endpoints, text pos).
    // Rect/ellipse/circle no longer need their own handles — bbox handles cover them.
    const specialty = (el.type === 'line' || el.type === 'text') && def.handles
        ? def.handles(el.attrs)
        : [];
    for (const h of specialty) {
        const sq = document.createElementNS(SVG_NS, 'rect');
        sq.setAttribute('class', `handle h-${h.kind}`);
        sq.setAttribute('x', h.x - HANDLE_SIZE / 2);
        sq.setAttribute('y', h.y - HANDLE_SIZE / 2);
        sq.setAttribute('width', HANDLE_SIZE);
        sq.setAttribute('height', HANDLE_SIZE);
        sq.setAttribute('data-handle', h.name);
        handlesLayer.appendChild(sq);
    }
}

function renderPolyHandles(el) {
    const pts = el.attrs.points || [];
    const DOT = 6;
    for (let i = 0; i < pts.length; i++) {
        const [x, y] = pts[i];
        const dot = document.createElementNS(SVG_NS, 'circle');
        const isSel = (i === state.selectedSegmentIdx);
        dot.setAttribute('class', 'path-segment-dot' + (isSel ? ' selected' : ''));
        dot.setAttribute('cx', x);
        dot.setAttribute('cy', y);
        dot.setAttribute('r', DOT / 2);
        dot.setAttribute('data-segment-idx', i);
        dot.setAttribute('data-handle', 'poly-point');
        handlesLayer.appendChild(dot);
    }
}

function renderPathHandles(el) {
    const segs = el.attrs.segments || [];
    const pts = pathPoints(segs);
    const DOT = 6;

    // Endpoint dot for each segment (clickable to select that segment)
    for (let i = 0; i < segs.length; i++) {
        const end = pts[i].end;
        const dot = document.createElementNS(SVG_NS, 'circle');
        const isSel = (i === state.selectedSegmentIdx);
        dot.setAttribute('class', 'path-segment-dot' + (isSel ? ' selected' : ''));
        dot.setAttribute('cx', end.x);
        dot.setAttribute('cy', end.y);
        dot.setAttribute('r', DOT / 2);
        dot.setAttribute('data-segment-idx', i);
        dot.setAttribute('data-handle', 'seg-end');
        handlesLayer.appendChild(dot);
    }

    // Control point handles for the selected segment
    const idx = state.selectedSegmentIdx;
    if (idx == null || idx < 0 || idx >= segs.length) return;
    const calc = pts[idx];
    const seg = segs[idx];
    const upper = seg.cmd.toUpperCase();

    const addCp = (name, p) => {
        // cp1 visually attaches to segment start; cp2 (incl. S) attaches to endpoint
        const anchor = (name === 'cp1') ? calc.start : calc.end;
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('class', 'path-cp-line');
        line.setAttribute('x1', anchor.x);
        line.setAttribute('y1', anchor.y);
        line.setAttribute('x2', p.x);
        line.setAttribute('y2', p.y);
        handlesLayer.appendChild(line);
        // Control point dot
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('class', 'path-cp-dot');
        dot.setAttribute('cx', p.x);
        dot.setAttribute('cy', p.y);
        dot.setAttribute('r', DOT / 2);
        dot.setAttribute('data-segment-idx', idx);
        dot.setAttribute('data-handle', name);
        handlesLayer.appendChild(dot);
    };
    if (calc.cp1) addCp('cp1', calc.cp1);
    if (calc.cp2) addCp('cp2', calc.cp2);
}

function computeBBox(el) {
    const def = TYPES[el.type];
    if (def.bbox) return def.bbox(el.attrs);
    const node = content.querySelector(`[data-editor-element="${el.id}"]`);
    if (node && node.getBBox) {
        try { return node.getBBox(); } catch (_) {}
    }
    return null;
}

// ===== Inspector =====
let inspectorBuiltForId = null;

function setInputValueIfNotFocused(input, value) {
    if (document.activeElement === input) return;
    input.value = value;
}

function buildGeomFields(el) {
    const geomDiv = document.getElementById('geom-fields');
    geomDiv.innerHTML = '';
    for (const f of TYPES[el.type].geomFields) {
        const row = document.createElement('div');
        row.className = 'row';
        const lab = document.createElement('label');
        lab.textContent = f;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.dataset.geomField = f;
        attachNumeric(inp, {
            getPrecision: () => state.precision,
            getStep: () => precisionStep(state.precision),
            onChange: (v) => {
                const cur = findElement(state.selectedId);
                if (!cur) return;
                cur.attrs[f] = v;
                render();
            },
        });
        row.appendChild(lab);
        row.appendChild(inp);
        geomDiv.appendChild(row);
    }
}

function updateInspector() {
    if (!state.selectedId) {
        inspectorEmpty.hidden = false;
        inspectorBody.hidden = true;
        inspectorBuiltForId = null;
        return;
    }
    const el = findElement(state.selectedId);
    if (!el) {
        inspectorEmpty.hidden = false;
        inspectorBody.hidden = true;
        inspectorBuiltForId = null;
        return;
    }
    inspectorEmpty.hidden = true;
    inspectorBody.hidden = false;
    document.getElementById('i-id').value = el.id;
    document.getElementById('i-type').value = el.type;

    document.getElementById('geom-group').hidden = (TYPES[el.type].geomFields || []).length === 0;

    if (inspectorBuiltForId !== el.id) {
        buildGeomFields(el);
        inspectorBuiltForId = el.id;
    }

    const geomDiv = document.getElementById('geom-fields');
    for (const inp of geomDiv.querySelectorAll('input[data-geom-field]')) {
        const f = inp.dataset.geomField;
        const v = el.attrs[f];
        setInputValueIfNotFocused(inp, typeof v === 'number' ? String(v) : (v ?? ''));
    }

    setInputValueIfNotFocused(document.getElementById('i-fill'), toHex(el.attrs.fill));
    const fo = document.getElementById('i-fill-opacity');
    setInputValueIfNotFocused(fo, el.attrs['fill-opacity'] ?? 1);
    document.getElementById('i-fill-opacity-val').textContent = (+fo.value).toFixed(2);

    setInputValueIfNotFocused(document.getElementById('i-stroke'), toHex(el.attrs.stroke));
    setInputValueIfNotFocused(document.getElementById('i-stroke-width'), el.attrs['stroke-width'] ?? 0);
    setInputValueIfNotFocused(document.getElementById('i-stroke-dash'), el.attrs['stroke-dasharray'] ?? '');

    const textGroup = document.getElementById('text-group');
    if (el.type === 'text') {
        textGroup.hidden = false;
        setInputValueIfNotFocused(document.getElementById('i-text-content'), el.attrs.content ?? '');
        setInputValueIfNotFocused(document.getElementById('i-text-size'), el.attrs['font-size'] ?? 16);
        setInputValueIfNotFocused(document.getElementById('i-text-family'), el.attrs['font-family'] ?? '');
    } else {
        textGroup.hidden = true;
    }

    const pathGroup = document.getElementById('path-group');
    if (el.type === 'path') {
        pathGroup.hidden = false;
        renderSegmentList(el);
    } else {
        pathGroup.hidden = true;
    }

    const polyGroup = document.getElementById('poly-group');
    if (el.type === 'polyline' || el.type === 'polygon') {
        polyGroup.hidden = false;
        renderPolyPointList(el);
    } else {
        polyGroup.hidden = true;
    }

    const imageGroup = document.getElementById('image-group');
    if (el.type === 'image') {
        imageGroup.hidden = false;
        updateImageHrefDisplay(el.attrs.href || '');
        const par = parsePreserveAspectRatio(el.attrs.preserveAspectRatio);
        const alignSel = document.getElementById('i-image-align');
        const modeSel = document.getElementById('i-image-mode');
        if (document.activeElement !== alignSel) alignSel.value = par.align;
        if (document.activeElement !== modeSel) modeSel.value = par.mode;
        modeSel.disabled = (par.align === 'none');
        const prefixInput = document.getElementById('i-image-prefix');
        const isDataUri = (el.attrs.href || '').startsWith('data:');
        prefixInput.disabled = isDataUri;
        if (document.activeElement !== prefixInput) {
            prefixInput.value = isDataUri ? '' : hrefPrefix(el.attrs.href || '');
        }
    } else {
        imageGroup.hidden = true;
    }
}

function hrefPrefix(href) {
    if (!href || href.startsWith('data:')) return '';
    const idx = href.lastIndexOf('/');
    return idx < 0 ? '' : href.slice(0, idx + 1);
}

function hrefFilename(href) {
    if (!href) return '';
    if (href.startsWith('data:')) return '';
    const idx = href.lastIndexOf('/');
    return idx < 0 ? href : href.slice(idx + 1);
}

function parsePreserveAspectRatio(value) {
    if (!value) return { align: 'xMidYMid', mode: 'meet' };
    const parts = value.trim().split(/\s+/);
    const align = parts[0] || 'xMidYMid';
    const mode = (align === 'none') ? 'meet' : (parts[1] || 'meet');
    return { align, mode };
}

function updateImageHrefDisplay(href) {
    const span = document.getElementById('i-image-href-display');
    let display, full = href;
    if (!href) {
        display = '(none)';
    } else if (href.startsWith('data:')) {
        const base64 = href.split(',')[1] || '';
        const bytes = Math.floor(base64.length * 3 / 4);
        const mime = (href.match(/^data:([^;,]+)/) || [])[1] || 'data';
        display = `[embedded ${mime}, ~${bytes.toLocaleString()} bytes]`;
        full = display;
    } else if (href.length > 60) {
        display = href.slice(0, 36) + '…' + href.slice(-20);
    } else {
        display = href;
    }
    span.textContent = display;
    span.title = full;
}

// ===== Path segment editor =====
let segmentsBuiltSig = null;

function segmentSig(el) {
    return el.id + '|' + (el.attrs.segments || []).map(s => s.cmd).join(',');
}

function renderSegmentList(el) {
    const sig = segmentSig(el);
    const container = document.getElementById('path-segments');
    if (segmentsBuiltSig !== sig) {
        buildSegmentList(el);
        segmentsBuiltSig = sig;
    }
    // Update values in place + selected highlight
    const segs = el.attrs.segments || [];
    for (const row of container.querySelectorAll('.segment-row')) {
        const i = parseInt(row.dataset.segmentIdx, 10);
        row.classList.toggle('selected', i === state.selectedSegmentIdx);
        const seg = segs[i];
        if (!seg) continue;
        const inputs = row.querySelectorAll('input[data-param-idx]');
        for (const inp of inputs) {
            const pi = parseInt(inp.dataset.paramIdx, 10);
            if (document.activeElement !== inp) inp.value = String(seg.params[pi] ?? 0);
        }
    }
}

function buildSegmentList(el) {
    const container = document.getElementById('path-segments');
    container.innerHTML = '';
    const segs = el.attrs.segments || [];
    for (let i = 0; i < segs.length; i++) {
        container.appendChild(buildSegmentRow(el, i));
    }
}

function buildSegmentRow(el, idx) {
    const seg = el.attrs.segments[idx];
    const upper = seg.cmd.toUpperCase();
    const isAbs = (seg.cmd === upper);
    const row = document.createElement('div');
    row.className = 'segment-row';
    if (idx === state.selectedSegmentIdx) row.classList.add('selected');
    row.dataset.segmentIdx = idx;

    row.addEventListener('click', (ev) => {
        if (ev.target.closest('button, select, input')) return;
        state.selectedSegmentIdx = idx;
        renderHandles();
        renderSegmentList(el);
    });

    const head = document.createElement('div');
    head.className = 'seg-head';

    const idxLabel = document.createElement('span');
    idxLabel.className = 'seg-idx';
    idxLabel.textContent = idx;
    head.appendChild(idxLabel);

    const sel = document.createElement('select');
    sel.className = 'seg-cmd';
    for (const c of ['M','L','H','V','C','S','Q','T','A','Z']) {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = isAbs ? c : c.toLowerCase();
        if (c === upper) opt.selected = true;
        sel.appendChild(opt);
    }
    sel.addEventListener('change', (ev) => {
        flushDebounce();
        const newUpper = ev.target.value;
        const wasAbs = (el.attrs.segments[idx].cmd === el.attrs.segments[idx].cmd.toUpperCase());
        const newCmd = wasAbs ? newUpper : newUpper.toLowerCase();
        const calc = pathPoints(el.attrs.segments);
        const cur = calc[idx].start;
        el.attrs.segments[idx] = {
            cmd: newCmd,
            params: defaultSegmentParams(newCmd, cur),
        };
        segmentsBuiltSig = null;
        render();
        pushHistory();
    });
    head.appendChild(sel);

    const relBtn = document.createElement('button');
    relBtn.className = 'seg-rel' + (isAbs ? ' is-abs' : '');
    relBtn.title = 'Toggle absolute / relative';
    relBtn.textContent = isAbs ? 'A' : 'r';
    relBtn.addEventListener('click', () => {
        flushDebounce();
        toggleSegmentAbs(el.attrs.segments, idx);
        render();
        pushHistory();
    });
    head.appendChild(relBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'seg-mini';
    delBtn.title = 'Delete segment';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => {
        flushDebounce();
        el.attrs.segments.splice(idx, 1);
        if (state.selectedSegmentIdx === idx) state.selectedSegmentIdx = null;
        else if (state.selectedSegmentIdx > idx) state.selectedSegmentIdx -= 1;
        segmentsBuiltSig = null;
        render();
        pushHistory();
    });
    head.appendChild(delBtn);

    const insBtn = document.createElement('button');
    insBtn.className = 'seg-mini';
    insBtn.title = 'Insert segment after this one';
    insBtn.textContent = '+';
    insBtn.addEventListener('click', () => {
        flushDebounce();
        const calc = pathPoints(el.attrs.segments);
        const cur = calc[idx].end;
        const newSeg = { cmd: 'l', params: defaultSegmentParams('l', cur) };
        el.attrs.segments.splice(idx + 1, 0, newSeg);
        state.selectedSegmentIdx = idx + 1;
        segmentsBuiltSig = null;
        render();
        pushHistory();
    });
    head.appendChild(insBtn);

    row.appendChild(head);

    const params = document.createElement('div');
    params.className = 'seg-params';
    const labels = PATH_PARAM_LABELS[upper] || [];
    for (let pi = 0; pi < labels.length; pi++) {
        const lab = document.createElement('label');
        lab.textContent = labels[pi];
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.dataset.paramIdx = pi;
        inp.value = String(seg.params[pi] ?? 0);
        attachNumeric(inp, {
            getPrecision: () => state.precision,
            getStep: () => precisionStep(state.precision),
            onChange: (v) => {
                el.attrs.segments[idx].params[pi] = v;
                render();
            },
        });
        params.appendChild(lab);
        params.appendChild(inp);
    }
    row.appendChild(params);
    return row;
}

// ===== Polyline / polygon point editor =====
let polyPointsBuiltSig = null;

function polySig(el) {
    return el.id + '|' + (el.attrs.points || []).length;
}

function renderPolyPointList(el) {
    const sig = polySig(el);
    const container = document.getElementById('poly-points');
    if (polyPointsBuiltSig !== sig) {
        buildPolyPointList(el);
        polyPointsBuiltSig = sig;
    }
    const pts = el.attrs.points || [];
    for (const row of container.querySelectorAll('.point-row')) {
        const i = parseInt(row.dataset.pointIdx, 10);
        row.classList.toggle('selected', i === state.selectedSegmentIdx);
        const pt = pts[i];
        if (!pt) continue;
        for (const inp of row.querySelectorAll('input[data-coord]')) {
            const axis = inp.dataset.coord;
            const v = axis === 'x' ? pt[0] : pt[1];
            if (document.activeElement !== inp) inp.value = String(v);
        }
    }
}

function buildPolyPointList(el) {
    const container = document.getElementById('poly-points');
    container.innerHTML = '';
    const pts = el.attrs.points || [];
    for (let i = 0; i < pts.length; i++) {
        container.appendChild(buildPolyPointRow(el, i));
    }
}

function buildPolyPointRow(el, idx) {
    const row = document.createElement('div');
    row.className = 'point-row';
    if (idx === state.selectedSegmentIdx) row.classList.add('selected');
    row.dataset.pointIdx = idx;

    row.addEventListener('click', (ev) => {
        if (ev.target.closest('button, input')) return;
        state.selectedSegmentIdx = idx;
        renderHandles();
        renderPolyPointList(el);
    });

    const head = document.createElement('div');
    head.className = 'point-head';

    const idxLabel = document.createElement('span');
    idxLabel.className = 'point-idx';
    idxLabel.textContent = idx;
    head.appendChild(idxLabel);

    const makeInput = (axis) => {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.dataset.coord = axis;
        inp.value = String(el.attrs.points[idx][axis === 'x' ? 0 : 1]);
        attachNumeric(inp, {
            getPrecision: () => state.precision,
            getStep: () => precisionStep(state.precision),
            onChange: (v) => {
                const cur = findElement(state.selectedId);
                if (!cur || !cur.attrs.points || !cur.attrs.points[idx]) return;
                cur.attrs.points[idx][axis === 'x' ? 0 : 1] = v;
                render();
            },
        });
        return inp;
    };
    head.appendChild(makeInput('x'));
    head.appendChild(makeInput('y'));

    const delBtn = document.createElement('button');
    delBtn.className = 'seg-mini';
    delBtn.title = 'Delete point';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => {
        flushDebounce();
        el.attrs.points.splice(idx, 1);
        if (state.selectedSegmentIdx === idx) state.selectedSegmentIdx = null;
        else if (state.selectedSegmentIdx > idx) state.selectedSegmentIdx -= 1;
        polyPointsBuiltSig = null;
        render();
        pushHistory();
    });
    head.appendChild(delBtn);

    const insBtn = document.createElement('button');
    insBtn.className = 'seg-mini';
    insBtn.title = 'Insert point after this one';
    insBtn.textContent = '+';
    insBtn.addEventListener('click', () => {
        flushDebounce();
        const pts = el.attrs.points;
        const cur = pts[idx];
        let newPt;
        if (idx + 1 < pts.length) {
            const next = pts[idx + 1];
            newPt = [(cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2];
        } else if (el.type === 'polygon' && pts.length > 0) {
            const next = pts[0];
            newPt = [(cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2];
        } else {
            newPt = [cur[0] + 20, cur[1] + 20];
        }
        pts.splice(idx + 1, 0, newPt);
        state.selectedSegmentIdx = idx + 1;
        polyPointsBuiltSig = null;
        render();
        pushHistory();
    });
    head.appendChild(insBtn);

    row.appendChild(head);
    return row;
}

document.getElementById('poly-add-point').addEventListener('click', () => {
    const el = findElement(state.selectedId);
    if (!el || (el.type !== 'polyline' && el.type !== 'polygon')) return;
    flushDebounce();
    const pts = el.attrs.points;
    let newPt;
    if (pts.length === 0) {
        newPt = [400, 300];
    } else {
        const last = pts[pts.length - 1];
        newPt = [last[0] + 30, last[1] + 30];
    }
    pts.push(newPt);
    state.selectedSegmentIdx = pts.length - 1;
    polyPointsBuiltSig = null;
    render();
    pushHistory();
});

document.getElementById('path-add-segment').addEventListener('click', () => {
    const el = findElement(state.selectedId);
    if (!el || el.type !== 'path') return;
    flushDebounce();
    const segs = el.attrs.segments;
    if (segs.length === 0) {
        segs.push({ cmd: 'M', params: [400, 300] });
        segs.push({ cmd: 'l', params: [100, 0] });
    } else {
        const cur = pathPoints(segs)[segs.length - 1].end;
        segs.push({ cmd: 'l', params: defaultSegmentParams('l', cur) });
    }
    state.selectedSegmentIdx = segs.length - 1;
    segmentsBuiltSig = null;
    render();
    pushHistory();
});

function wireInspector() {
    const setAttr = (key, val) => {
        const el = findElement(state.selectedId);
        if (!el) return;
        if (val === '' || val === null || val === undefined) delete el.attrs[key];
        else el.attrs[key] = val;
        render();
    };
    document.getElementById('i-fill').addEventListener('input', (e) => {
        setAttr('fill', e.target.value);
        pushHistoryDebounced();
    });
    document.getElementById('i-fill-none').addEventListener('click', () => {
        flushDebounce();
        setAttr('fill', 'none');
        pushHistory();
    });
    document.getElementById('i-fill-opacity').addEventListener('input', (e) => {
        document.getElementById('i-fill-opacity-val').textContent = (+e.target.value).toFixed(2);
        setAttr('fill-opacity', +e.target.value);
        pushHistoryDebounced();
    });
    document.getElementById('i-stroke').addEventListener('input', (e) => {
        setAttr('stroke', e.target.value);
        pushHistoryDebounced();
    });
    document.getElementById('i-stroke-none').addEventListener('click', () => {
        flushDebounce();
        setAttr('stroke', 'none');
        pushHistory();
    });
    attachNumeric(document.getElementById('i-stroke-width'), {
        getPrecision: () => state.precision,
        getStep: () => precisionStep(state.precision),
        onChange: (v) => setAttr('stroke-width', v),
    });
    document.getElementById('i-stroke-dash').addEventListener('input', (e) => {
        const v = e.target.value.trim();
        setAttr('stroke-dasharray', v || '');
        pushHistoryDebounced();
    });
    document.getElementById('i-text-content').addEventListener('input', (e) => {
        setAttr('content', e.target.value);
        pushHistoryDebounced();
    });
    attachNumeric(document.getElementById('i-text-size'), {
        getPrecision: () => 0,
        getStep: () => 1,
        onChange: (v) => setAttr('font-size', v),
    });
    document.getElementById('i-text-family').addEventListener('input', (e) => {
        setAttr('font-family', e.target.value);
        pushHistoryDebounced();
    });
}

// ===== Source text =====
function serialize() {
    const c = state.canvas;
    const viewBox = `${formatPathNum(c.x)} ${formatPathNum(c.y)} ${formatPathNum(c.width)} ${formatPathNum(c.height)}`;
    const lines = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`];
    for (const el of state.elements) lines.push('  ' + serializeElement(el));
    lines.push('</svg>');
    return lines.join('\n');
}

// ===== Canvas (viewBox) =====
function applyCanvasViewBox() {
    const c = state.canvas;
    canvas.setAttribute('viewBox', `${c.x} ${c.y} ${c.width} ${c.height}`);
    syncCanvasInputs();
    renderGrid();
    if (state.grid.enabled) renderHtmlRulers();
}

function syncCanvasInputs() {
    const c = state.canvas;
    const setIf = (id, val) => {
        const el = document.getElementById(id);
        if (!el || document.activeElement === el) return;
        el.value = formatPathNum(val);
    };
    setIf('canvas-x', c.x);
    setIf('canvas-y', c.y);
    setIf('canvas-w', c.width);
    setIf('canvas-h', c.height);
}

function setCanvasDim(field, value) {
    const c = state.canvas;
    if (c[field] === value) return;
    if (state.canvasAspectLocked && (field === 'width' || field === 'height')) {
        const ratio = state.canvasLockedAspect || (c.width / c.height) || 1;
        if (field === 'width') {
            c.width = value;
            c.height = value / ratio;
        } else {
            c.height = value;
            c.width = value * ratio;
        }
    } else {
        c[field] = value;
    }
    applyCanvasViewBox();
}

function toggleCanvasAspectLock() {
    state.canvasAspectLocked = !state.canvasAspectLocked;
    const btn = document.getElementById('canvas-aspect-lock');
    if (state.canvasAspectLocked) {
        const c = state.canvas;
        state.canvasLockedAspect = (c.height !== 0) ? (c.width / c.height) : 1;
        btn.setAttribute('aria-pressed', 'true');
    } else {
        state.canvasLockedAspect = null;
        btn.setAttribute('aria-pressed', 'false');
    }
}

function applyCanvasPreset(spec) {
    if (!spec) return;
    const [w, h] = spec.split(',').map(Number);
    if (!isFinite(w) || !isFinite(h)) return;
    flushDebounce();
    state.canvas.width = w;
    state.canvas.height = h;
    if (state.canvasAspectLocked) state.canvasLockedAspect = (h !== 0) ? w / h : 1;
    applyCanvasViewBox();
    pushHistory();
}

function serializeElement(el) {
    const a = el.attrs;
    const parts = [`id="${el.id}"`];
    if (el.type === 'text') {
        for (const k of ['x','y','font-size','font-family','fill','fill-opacity','stroke','stroke-width','stroke-dasharray']) {
            if (a[k] !== undefined && a[k] !== null && a[k] !== '') parts.push(`${k}="${escapeAttr(a[k])}"`);
        }
        return `<text ${parts.join(' ')}>${escapeText(a.content ?? '')}</text>`;
    }
    if (el.type === 'path') {
        parts.push(`d="${escapeAttr(serializePathData(a.segments))}"`);
        for (const k of ['fill','fill-opacity','stroke','stroke-width','stroke-dasharray','stroke-linecap','stroke-linejoin']) {
            if (a[k] !== undefined && a[k] !== null && a[k] !== '') parts.push(`${k}="${escapeAttr(a[k])}"`);
        }
        return `<path ${parts.join(' ')} />`;
    }
    if (el.type === 'polyline' || el.type === 'polygon') {
        parts.push(`points="${escapeAttr(serializePoints(a.points))}"`);
        for (const k of ['fill','fill-opacity','stroke','stroke-width','stroke-dasharray','stroke-linecap','stroke-linejoin']) {
            if (a[k] !== undefined && a[k] !== null && a[k] !== '') parts.push(`${k}="${escapeAttr(a[k])}"`);
        }
        return `<${el.type} ${parts.join(' ')} />`;
    }
    if (el.type === 'image') {
        for (const k of ['x','y','width','height','preserveAspectRatio']) {
            if (a[k] !== undefined && a[k] !== null && a[k] !== '') parts.push(`${k}="${escapeAttr(a[k])}"`);
        }
        if (a.href) parts.push(`href="${escapeAttr(a.href)}"`);
        return `<image ${parts.join(' ')} />`;
    }
    for (const [k, v] of Object.entries(a)) {
        if (k === 'content') continue;
        if (v === undefined || v === null || v === '') continue;
        parts.push(`${k}="${escapeAttr(v)}"`);
    }
    return `<${el.type} ${parts.join(' ')} />`;
}

let canonicalSource = '';
const applyBtn = document.getElementById('btn-apply-source');

function updateSource() {
    canonicalSource = serialize();
    sourceEl.value = canonicalSource;
    if (applyBtn) applyBtn.disabled = true;
}

function findElementLineInSource(text, tag) {
    const safe = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('<' + safe + '(?=[\\s/>])', 'i');
    const m = re.exec(text);
    if (!m) return 0;
    return text.slice(0, m.index).split('\n').length;
}

function summarizeParseError(errEl) {
    const raw = (errEl.textContent || '').replace(/\s+/g, ' ').trim();
    const lineMatch = raw.match(/[Ll]ine\s*[Nn]umber\s*[:\s]*(\d+)/) || raw.match(/[Ll]ine\s+(\d+)/);
    const lineNum = lineMatch ? parseInt(lineMatch[1], 10) : null;

    let desc = raw
        .replace(/This page contains the following errors?:?/i, '')
        .replace(/XML Parsing Error:?/i, '')
        .replace(/^error on line \d+ at column \d+:?/i, '')
        .replace(/Location:[^]*$/i, '')
        .replace(/[Ll]ine\s*[Nn]umber\s*[:\s]*\d+(,\s*[Cc]olumn\s*\d+)?:?/, '')
        .replace(/Below is a rendering of the page up to the first error\.?/i, '')
        .trim()
        .replace(/^[:\-\s]+/, '')
        .slice(0, 140);

    if (!desc) desc = 'unable to parse XML';
    return lineNum != null
        ? `Line ${lineNum}: ${desc}`
        : `Unknown parsing error: ${desc}`;
}

function validateSource(text) {
    if (!text || !text.trim()) return { error: 'Empty input' };

    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'image/svg+xml');
    const errEl = doc.querySelector('parsererror');
    if (errEl) return { error: summarizeParseError(errEl) };

    const root = doc.documentElement;
    if (!root || root.tagName.toLowerCase() !== 'svg') {
        const tagSeen = root ? `<${root.tagName.toLowerCase()}>` : 'no root element';
        return { error: `Not SVG format (root is ${tagSeen})` };
    }

    for (const child of root.children) {
        const tag = child.tagName.toLowerCase();
        if (!TYPES[tag]) {
            const line = findElementLineInSource(text, tag);
            const linePart = line > 0 ? `Line ${line}: ` : '';
            return { error: `${linePart}element <${tag}> not supported` };
        }
    }
    return { svg: root };
}

function applySource() {
    const txt = sourceEl.value;
    const v = validateSource(txt);
    if (v.error) {
        showSourceStatus(v.error, true);
        return;
    }
    flushDebounce();
    const svg = v.svg;
    const vb = svg.getAttribute('viewBox');
    if (vb) {
        const parts = vb.split(/\s+/).map(parseFloat);
        if (parts.length === 4 && parts.every(n => isFinite(n))) {
            state.canvas = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
            applyCanvasViewBox();
        }
    }

    const newElements = [];
    let maxId = state.nextId;
    for (const child of svg.children) {
        const type = child.tagName.toLowerCase();
        const attrs = {};
        for (const at of child.attributes) {
            if (at.name === 'id') continue;
            attrs[at.name] = NUMERIC_ATTRS.has(at.name) ? parseFloat(at.value) : at.value;
        }
        if (type === 'text') attrs.content = child.textContent;
        if (type === 'path') {
            try {
                attrs.segments = parsePathData(child.getAttribute('d') || '');
            } catch (e) {
                showSourceStatus(`Invalid path d: ${e.message}`, true);
                return;
            }
            delete attrs.d;
        }
        if (type === 'polyline' || type === 'polygon') {
            try {
                attrs.points = parsePoints(child.getAttribute('points') || '');
            } catch (e) {
                showSourceStatus(`Invalid ${type} points: ${e.message}`, true);
                return;
            }
        }
        if (type === 'image') {
            // Legacy: xlink:href → href
            if (!attrs.href && attrs['xlink:href']) attrs.href = attrs['xlink:href'];
            delete attrs['xlink:href'];
        }
        const defaults = TYPES[type].defaults();
        for (const k of Object.keys(defaults)) {
            if (attrs[k] === undefined) attrs[k] = defaults[k];
        }
        const id = child.getAttribute('id') || nextId(type);
        const m = id.match(/-(\d+)$/);
        if (m) maxId = Math.max(maxId, parseInt(m[1], 10) + 1);
        newElements.push({ id, type, attrs });
    }
    state.elements = newElements;
    state.nextId = maxId;
    state.selectedId = null;
    showSourceStatus('Applied', false);
    render();
    if (state.grid.enabled) renderHtmlRulers();
    pushHistory();
}

let lastFilename = 'drawing.svg';
const svgPickerTypes = [{
    description: 'SVG file',
    accept: { 'image/svg+xml': ['.svg'] },
}];

async function saveSourceToFile() {
    const txt = sourceEl.value;
    if (!txt.trim()) {
        showSourceStatus('Nothing to save', true);
        return;
    }
    // Preferred: File System Access API (Chrome/Edge). Gives a real "Save As" dialog.
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: lastFilename,
                types: svgPickerTypes,
            });
            const writable = await handle.createWritable();
            await writable.write(txt);
            await writable.close();
            lastFilename = handle.name;
            showSourceStatus(`Saved ${handle.name}`, false);
        } catch (err) {
            if (err.name !== 'AbortError') {
                showSourceStatus(`Save failed: ${err.message || err.name}`, true);
            }
        }
        return;
    }
    // Fallback: prompt for filename, then trigger a download via blob URL.
    const input = prompt('Save as (filename):', lastFilename);
    if (input === null) return;
    const name = input.trim() || 'drawing.svg';
    lastFilename = name;
    const blob = new Blob([txt], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showSourceStatus(`Saved ${name}`, false);
}

async function openSourceFromFile() {
    // Preferred: File System Access API gives a real "Open" dialog.
    if (window.showOpenFilePicker) {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: svgPickerTypes,
                multiple: false,
            });
            const file = await handle.getFile();
            lastFilename = file.name;
            readFileIntoSource(file);
        } catch (err) {
            if (err.name !== 'AbortError') {
                showSourceStatus(`Open failed: ${err.message || err.name}`, true);
            }
        }
        return;
    }
    // Fallback: trigger the hidden <input type="file">.
    fileInput.click();
}

function readFileIntoSource(file) {
    const reader = new FileReader();
    reader.onload = () => {
        sourceEl.value = String(reader.result ?? '');
        applyBtn.disabled = sourceEl.value === canonicalSource;
        applySource();
    };
    reader.onerror = () => {
        showSourceStatus('Could not read file: ' + (reader.error?.message || 'unknown error'), true);
    };
    reader.readAsText(file);
}

function showSourceStatus(msg, isError) {
    sourceStatus.textContent = msg;
    sourceStatus.style.color = isError ? 'var(--danger)' : '';
    if (!isError) setTimeout(() => { sourceStatus.textContent = ''; }, 1500);
}

// ===== Tool / palette =====
function setTool(tool) {
    if (tool !== 'select' && !TYPES[tool]) return;
    state.tool = tool;
    toolNameEl.textContent = tool;
    updateToolUI();
}

function updateToolUI() {
    for (const btn of palette.querySelectorAll('.tool-btn')) {
        btn.classList.toggle('active', btn.dataset.tool === state.tool);
    }
    canvas.classList.toggle('tool-add', state.tool !== 'select');
}

palette.addEventListener('click', (e) => {
    const btn = e.target.closest('.tool-btn[data-tool]');
    if (!btn) return;
    setTool(btn.dataset.tool);
});

// ===== Selection =====
function selectElement(id) {
    if (state.selectedId !== id) state.selectedSegmentIdx = null;
    state.selectedId = id;
    renderHandles();
    updateInspector();
}

// ===== Add element =====
function addElement(type, p) {
    const def = TYPES[type];
    const attrs = { ...def.defaults(), ...def.atPoint(p) };
    const el = { id: nextId(type), type, attrs };
    state.elements.push(el);
    state.selectedId = el.id;
    return el;
}

// ===== Pointer interaction =====
let drag = null;

canvas.addEventListener('pointerdown', (e) => {
    flushDebounce();
    const p = svgPoint(e.clientX, e.clientY);

    if (state.tool !== 'select') {
        if (state.tool === 'image') {
            const dropPoint = p;
            setTool('select');
            startImagePlacement(dropPoint);
            return;
        }
        addElement(state.tool, p);
        setTool('select');
        render();
        pushHistory();
        return;
    }

    const handleEl = e.target.closest('[data-handle]');
    if (handleEl) {
        const el = findElement(state.selectedId);
        if (!el) return;
        const handleName = handleEl.dataset.handle;

        // Bbox scale handle
        if (handleName.startsWith('scale-')) {
            const dir = handleName.slice(6);
            const bb = computeBBox(el);
            if (bb) {
                drag = {
                    kind: 'scale',
                    dir,
                    anchor: bboxAnchor(dir, bb),
                    origBBox: { x: bb.x, y: bb.y, width: bb.width, height: bb.height },
                    startAttrs: cloneAttrs(el.attrs),
                };
                canvas.setPointerCapture(e.pointerId);
                e.preventDefault();
            }
            return;
        }

        // Polyline / polygon: point dot click selects; drag moves the vertex.
        if (handleName === 'poly-point') {
            const ptIdx = parseInt(handleEl.dataset.segmentIdx, 10);
            if (state.selectedSegmentIdx !== ptIdx) {
                state.selectedSegmentIdx = ptIdx;
                render();
            }
            drag = {
                kind: 'poly-handle',
                ptIdx,
                startPoint: p,
                startAttrs: cloneAttrs(el.attrs),
            };
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
        }

        // Path: segment dot click selects the segment; cp/end drag edits the segment.
        if (el.type === 'path') {
            const segIdxStr = handleEl.dataset.segmentIdx;
            const segIdx = segIdxStr != null ? parseInt(segIdxStr, 10) : -1;
            if (handleName === 'seg-end') {
                if (state.selectedSegmentIdx !== segIdx) {
                    state.selectedSegmentIdx = segIdx;
                    render();
                }
                drag = {
                    kind: 'path-handle',
                    handleName: 'end',
                    segIdx,
                    startPoint: p,
                    startAttrs: cloneAttrs(el.attrs),
                };
            } else if (handleName === 'cp1' || handleName === 'cp2') {
                drag = {
                    kind: 'path-handle',
                    handleName,
                    segIdx,
                    startPoint: p,
                    startAttrs: cloneAttrs(el.attrs),
                };
            }
            if (drag) {
                canvas.setPointerCapture(e.pointerId);
                e.preventDefault();
            }
            return;
        }
        drag = {
            kind: 'handle',
            handleName,
            startPoint: p,
            startAttrs: { ...el.attrs },
        };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
    }

    const elementEl = e.target.closest('[data-editor-element]');
    if (elementEl) {
        const id = elementEl.dataset.editorElement;
        if (state.selectedId !== id) selectElement(id);
        const el = findElement(state.selectedId);
        drag = {
            kind: 'move',
            startPoint: p,
            startAttrs: cloneAttrs(el.attrs),
        };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
    }

    if (state.selectedId) selectElement(null);
});

function cloneAttrs(attrs) {
    const out = { ...attrs };
    if (Array.isArray(attrs.segments)) {
        out.segments = attrs.segments.map(s => ({ cmd: s.cmd, params: s.params.slice() }));
    }
    if (Array.isArray(attrs.points)) {
        out.points = attrs.points.map(pt => pt.slice());
    }
    return out;
}

canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = svgPoint(e.clientX, e.clientY);
    const el = findElement(state.selectedId);
    if (!el) return;
    const def = TYPES[el.type];
    if (drag.kind === 'move') {
        const dx = p.x - drag.startPoint.x;
        const dy = p.y - drag.startPoint.y;
        el.attrs = cloneAttrs(drag.startAttrs);
        def.translate(el.attrs, dx, dy);
        snapGeom(el, state.precision);
    } else if (drag.kind === 'scale') {
        // Scale relative to the bbox at drag-start. Precision is intentionally
        // NOT honored for scale (per spec).
        const bb = drag.origBBox;
        const anchor = drag.anchor;
        const orig = bboxHandlePos(drag.dir, bb);
        const hasX = drag.dir.includes('e') || drag.dir.includes('w');
        const hasY = drag.dir.includes('n') || drag.dir.includes('s');
        let sx = 1, sy = 1;
        if (hasX && (orig.x - anchor.x) !== 0) sx = (p.x - anchor.x) / (orig.x - anchor.x);
        if (hasY && (orig.y - anchor.y) !== 0) sy = (p.y - anchor.y) / (orig.y - anchor.y);
        const isCorner = (drag.dir.length === 2);
        if (isCorner && e.shiftKey) {
            const mag = Math.max(Math.abs(sx), Math.abs(sy));
            sx = Math.sign(sx || 1) * mag;
            sy = Math.sign(sy || 1) * mag;
        }
        el.attrs = cloneAttrs(drag.startAttrs);
        if (def.scaleAround) def.scaleAround(el.attrs, anchor, sx, sy);
    } else if (drag.kind === 'path-handle') {
        el.attrs = cloneAttrs(drag.startAttrs);
        const snapped = state.precision === 'free'
            ? p
            : { x: roundTo(p.x, state.precision), y: roundTo(p.y, state.precision) };
        applyPathHandle(el.attrs.segments, drag.segIdx, drag.handleName, snapped);
    } else if (drag.kind === 'poly-handle') {
        el.attrs = cloneAttrs(drag.startAttrs);
        const snapped = state.precision === 'free'
            ? p
            : { x: roundTo(p.x, state.precision), y: roundTo(p.y, state.precision) };
        if (el.attrs.points && el.attrs.points[drag.ptIdx]) {
            el.attrs.points[drag.ptIdx] = [snapped.x, snapped.y];
        }
    } else {
        el.attrs = { ...drag.startAttrs };
        def.applyHandle(el.attrs, drag.handleName, p);
        snapGeom(el, state.precision);
    }
    render();
});

canvas.addEventListener('pointerup', (e) => {
    if (drag) {
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        drag = null;
        pushHistory();
    }
});

// ===== Keyboard =====
document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        undo();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === ']' || e.key === '[')) {
        e.preventDefault();
        const isForward = (e.key === ']');
        if (e.shiftKey) zMoveSelected(isForward ? 'front' : 'back');
        else            zMoveSelected(isForward ? 'forward' : 'backward');
        return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
        e.preventDefault();
    } else if (e.key === 'Escape') {
        if (state.tool !== 'select') setTool('select');
        else if (state.selectedId) selectElement(null);
    }
});

function deleteSelected() {
    if (!state.selectedId) return;
    flushDebounce();
    const idx = state.elements.findIndex(el => el.id === state.selectedId);
    if (idx >= 0) state.elements.splice(idx, 1);
    state.selectedId = null;
    render();
    pushHistory();
}

document.getElementById('btn-delete').addEventListener('click', deleteSelected);
document.getElementById('btn-clear').addEventListener('click', () => {
    if (state.elements.length === 0) return;
    if (!confirm('Remove all elements?')) return;
    flushDebounce();
    state.elements = [];
    state.selectedId = null;
    render();
    pushHistory();
});

function duplicateSelected() {
    if (!state.selectedId) return;
    const el = findElement(state.selectedId);
    if (!el) return;
    flushDebounce();
    const newAttrs = cloneAttrs(el.attrs);
    const def = TYPES[el.type];
    if (def.translate) def.translate(newAttrs, 10, 10);
    const newEl = { id: nextId(el.type), type: el.type, attrs: newAttrs };
    state.elements.push(newEl);
    state.selectedId = newEl.id;
    state.selectedSegmentIdx = null;
    render();
    pushHistory();
}

function snapSelectedToPrecision() {
    if (!state.selectedId) return;
    if (state.precision === 'free') return;
    const el = findElement(state.selectedId);
    if (!el) return;
    flushDebounce();
    const prec = state.precision;
    const def = TYPES[el.type];
    for (const f of (def.geomFields || [])) {
        if (typeof el.attrs[f] === 'number') el.attrs[f] = roundTo(el.attrs[f], prec);
    }
    if (typeof el.attrs['stroke-width'] === 'number') {
        el.attrs['stroke-width'] = roundTo(el.attrs['stroke-width'], prec);
    }
    if (el.type === 'text' && typeof el.attrs['font-size'] === 'number') {
        el.attrs['font-size'] = roundTo(el.attrs['font-size'], prec);
    }
    if (el.type === 'path' && Array.isArray(el.attrs.segments)) {
        for (const seg of el.attrs.segments) {
            for (let i = 0; i < seg.params.length; i++) {
                if (typeof seg.params[i] === 'number') {
                    seg.params[i] = roundTo(seg.params[i], prec);
                }
            }
        }
    }
    if ((el.type === 'polyline' || el.type === 'polygon') && Array.isArray(el.attrs.points)) {
        for (const pt of el.attrs.points) {
            pt[0] = roundTo(pt[0], prec);
            pt[1] = roundTo(pt[1], prec);
        }
    }
    render();
    pushHistory();
}

document.getElementById('btn-duplicate').addEventListener('click', duplicateSelected);
document.getElementById('btn-snap-precision').addEventListener('click', snapSelectedToPrecision);
document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);

function zMoveSelected(direction) {
    if (!state.selectedId) return;
    const idx = state.elements.findIndex(el => el.id === state.selectedId);
    if (idx < 0) return;
    let newIdx;
    if (direction === 'front')         newIdx = state.elements.length - 1;
    else if (direction === 'back')     newIdx = 0;
    else if (direction === 'forward')  newIdx = Math.min(idx + 1, state.elements.length - 1);
    else if (direction === 'backward') newIdx = Math.max(idx - 1, 0);
    else return;
    if (newIdx === idx) return;
    flushDebounce();
    const [el] = state.elements.splice(idx, 1);
    state.elements.splice(newIdx, 0, el);
    render();
    pushHistory();
}

document.getElementById('btn-z-front').addEventListener('click',    () => zMoveSelected('front'));
document.getElementById('btn-z-forward').addEventListener('click',  () => zMoveSelected('forward'));
document.getElementById('btn-z-backward').addEventListener('click', () => zMoveSelected('backward'));
document.getElementById('btn-z-back').addEventListener('click',     () => zMoveSelected('back'));
applyBtn.addEventListener('click', applySource);
sourceEl.addEventListener('input', () => {
    applyBtn.disabled = sourceEl.value === canonicalSource;
});
// ===== Image element file/URL handling =====
const imageFileInput = document.getElementById('image-file-input');

function fileToDataURI(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('read failed'));
        reader.readAsDataURL(file);
    });
}

function probeImageDimensions(uri) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || 100, height: img.naturalHeight || 100 });
        img.onerror = () => reject(new Error('could not decode image'));
        img.src = uri;
    });
}

async function pickImageFile() {
    if (window.showOpenFilePicker) {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: 'Image', accept: { 'image/*': ['.png','.jpg','.jpeg','.gif','.webp','.svg','.bmp'] } }],
                multiple: false,
            });
            return await handle.getFile();
        } catch (err) {
            if (err.name === 'AbortError') return null;
            showSourceStatus(`Open failed: ${err.message || err.name}`, true);
            return null;
        }
    }
    return new Promise(resolve => {
        const handler = () => {
            imageFileInput.removeEventListener('change', handler);
            const f = imageFileInput.files && imageFileInput.files[0];
            imageFileInput.value = '';
            resolve(f || null);
        };
        imageFileInput.addEventListener('change', handler);
        imageFileInput.click();
    });
}

function revokeDisplayHref(attrs) {
    if (attrs && typeof attrs._displayHref === 'string' && attrs._displayHref.startsWith('blob:')) {
        try { URL.revokeObjectURL(attrs._displayHref); } catch (_) {}
    }
}

async function startImagePlacement(point) {
    const file = await pickImageFile();
    if (!file) return;
    const displayUrl = URL.createObjectURL(file);
    let dims;
    try { dims = await probeImageDimensions(displayUrl); }
    catch (e) {
        URL.revokeObjectURL(displayUrl);
        showSourceStatus(`${e.message}`, true);
        return;
    }
    flushDebounce();
    const attrs = {
        x: point.x,
        y: point.y,
        width: dims.width,
        height: dims.height,
        href: state.lastImagePrefix + file.name, // prefix + filename, written to source
        _displayHref: displayUrl,                 // session-only blob URL for editor rendering
        preserveAspectRatio: 'xMidYMid meet',
    };
    const el = { id: nextId('image'), type: 'image', attrs };
    state.elements.push(el);
    state.selectedId = el.id;
    state.selectedSegmentIdx = null;
    render();
    pushHistory();
}

async function replaceSelectedImageFromFile() {
    const el = findElement(state.selectedId);
    if (!el || el.type !== 'image') return;
    const file = await pickImageFile();
    if (!file) return;
    flushDebounce();
    revokeDisplayHref(el.attrs);
    el.attrs._displayHref = URL.createObjectURL(file);
    // Preserve the image's existing prefix if it has one; otherwise use the sticky default.
    const curPrefix = hrefPrefix(el.attrs.href || '') || state.lastImagePrefix;
    el.attrs.href = curPrefix + file.name;
    render();
    pushHistory();
}

function setSelectedImageHrefFromUrl() {
    const el = findElement(state.selectedId);
    if (!el || el.type !== 'image') return;
    const cur = el.attrs.href && !el.attrs.href.startsWith('data:') ? el.attrs.href : '';
    const url = prompt('Image URL (use a data: URI to embed inline):', cur);
    if (url === null) return;
    flushDebounce();
    revokeDisplayHref(el.attrs);
    delete el.attrs._displayHref;
    el.attrs.href = url.trim();
    render();
    pushHistory();
}

document.getElementById('btn-image-file').addEventListener('click', replaceSelectedImageFromFile);
document.getElementById('btn-image-url').addEventListener('click', setSelectedImageHrefFromUrl);

function applyImagePreserveAspectRatio() {
    const el = findElement(state.selectedId);
    if (!el || el.type !== 'image') return;
    const align = document.getElementById('i-image-align').value;
    const mode = document.getElementById('i-image-mode').value;
    flushDebounce();
    el.attrs.preserveAspectRatio = (align === 'none') ? 'none' : `${align} ${mode}`;
    document.getElementById('i-image-mode').disabled = (align === 'none');
    render();
    pushHistory();
}
document.getElementById('i-image-align').addEventListener('change', applyImagePreserveAspectRatio);
document.getElementById('i-image-mode').addEventListener('change', applyImagePreserveAspectRatio);

document.getElementById('i-image-prefix').addEventListener('input', (e) => {
    const prefix = e.target.value;
    state.lastImagePrefix = prefix; // sticky for future adds
    const el = findElement(state.selectedId);
    if (!el || el.type !== 'image') return;
    const cur = el.attrs.href || '';
    if (cur.startsWith('data:')) return;
    el.attrs.href = prefix + hrefFilename(cur);
    render();
    pushHistoryDebounced();
});

document.getElementById('btn-save-source').addEventListener('click', saveSourceToFile);
const fileInput = document.getElementById('file-input');
document.getElementById('btn-open-source').addEventListener('click', openSourceFromFile);
fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
        lastFilename = file.name;
        readFileIntoSource(file);
    }
    e.target.value = '';
});

document.getElementById('precision-select').addEventListener('change', (e) => {
    const v = e.target.value;
    state.precision = (v === 'free') ? 'free' : parseInt(v, 10);
});

const canvasWrap = document.getElementById('canvas-wrap');
const gridToggle = document.getElementById('grid-toggle');
const gridSpacing = document.getElementById('grid-spacing');
const gridSpacingVal = document.getElementById('grid-spacing-val');

function applyGridVisibility() {
    canvasWrap.classList.toggle('grid-on', state.grid.enabled);
}

gridToggle.addEventListener('change', (e) => {
    state.grid.enabled = e.target.checked;
    applyGridVisibility();
    renderGrid();
    // Wait one frame for the grid cell to resize before measuring CTM.
    requestAnimationFrame(renderHtmlRulers);
});
gridSpacing.addEventListener('input', (e) => {
    state.grid.spacing = parseInt(e.target.value, 10);
    gridSpacingVal.textContent = state.grid.spacing;
    if (state.grid.enabled) {
        renderGrid();
        renderHtmlRulers();
    }
});

// Re-position HTML ruler ticks whenever the canvas changes size.
const ro = new ResizeObserver(() => {
    if (state.grid.enabled) renderHtmlRulers();
});
ro.observe(canvas);

// Canvas viewBox inputs
for (const [id, field] of [['canvas-x','x'], ['canvas-y','y'], ['canvas-w','width'], ['canvas-h','height']]) {
    attachNumeric(document.getElementById(id), {
        getPrecision: () => state.precision,
        getStep: () => precisionStep(state.precision),
        onChange: (v) => setCanvasDim(field, v),
    });
}
document.getElementById('canvas-aspect-lock').addEventListener('click', toggleCanvasAspectLock);
document.getElementById('canvas-preset').addEventListener('change', (e) => {
    const spec = e.target.value;
    e.target.value = '';
    applyCanvasPreset(spec);
});

// ===== Init =====
wireInspector();

// Sync state with form values the browser may have restored across reloads.
state.grid.enabled = gridToggle.checked;
state.grid.spacing = parseInt(gridSpacing.value, 10) || state.grid.spacing;
gridSpacingVal.textContent = state.grid.spacing;
applyGridVisibility();
const precVal = document.getElementById('precision-select').value;
state.precision = (precVal === 'free') ? 'free' : parseInt(precVal, 10);

// Initialize canvas viewBox from the HTML attribute, then mirror to inputs.
{
    const vb = canvas.getAttribute('viewBox') || '0 0 800 600';
    const parts = vb.split(/\s+/).map(parseFloat);
    if (parts.length === 4 && parts.every(n => isFinite(n))) {
        state.canvas = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
    }
    applyCanvasViewBox();
}

render();
// Rulers depend on the canvas's measured size after layout, so wait one frame.
if (state.grid.enabled) requestAnimationFrame(renderHtmlRulers);
// Seed the undo history with the initial state.
pushHistory();
updateUndoButtons();

})();
