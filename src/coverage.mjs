// Zones as one coverage. The drawn shapes are trimmed by family priority first, so neighbours share an exact
// edge. TopoJSON then splits every boundary into arcs between nodes, the points where three or more zones meet
// or two part ways. Each arc is rounded once, with its nodes pinned, and the zones are rebuilt from the rounded
// arcs: neighbours keep one common edge whatever the number of zones at a junction. This is topology preserving
// generalisation, the method of TopoJSON, mapshaper and GEOS coverage simplification, applied to corner rounding.
import * as turf from '@turf/turf';
import * as ts from 'topojson-server';
import * as tc from 'topojson-client';

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// Chaikin corner cutting, the same cuts as turf.polygonSmooth. An open arc keeps its two end points.
export function chaikin(points, iterations, closed) {
  let p = points;
  for (let k = 0; k < iterations; k++) {
    const out = [];
    if (closed) {
      for (let i = 0; i < p.length - 1; i++) out.push(lerp(p[i], p[i + 1], 0.25), lerp(p[i], p[i + 1], 0.75));
      out.push(out[0]);
    } else {
      if (p.length < 3) return p;
      out.push(p[0]);
      for (let i = 0; i < p.length - 1; i++) {
        if (i > 0) out.push(lerp(p[i], p[i + 1], 0.25));
        if (i < p.length - 2) out.push(lerp(p[i], p[i + 1], 0.75));
      }
      out.push(p[p.length - 1]);
    }
    p = out;
  }
  return p;
}

const rings = f => !f ? [] : f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
const round = c => [Math.round(c[0] * 1e9) / 1e9, Math.round(c[1] * 1e9) / 1e9];
const key = c => c[0] + ',' + c[1];

// The clip cut to the box around a shape plus a margin, so the land intersection only walks the coast nearby.
// The margin keeps the cut edges clear of the shape, so the intersection comes out the same.
function near(clip, [w, s, e, n], margin = 0.1) {
  const g = turf.bboxClip(clip, [w - margin, s - margin, e + margin, n + margin]).geometry;
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).filter(p => p[0]?.length >= 4).map(p => p.filter(r => r.length >= 4));
  return polys.length ? turf.multiPolygon(polys) : null;
}

// Where one zone's vertex lies on another zone's edge, the edge gets that vertex too, so both boundaries
// carry the same points and TopoJSON sees one shared arc. Trimming leaves such points on the trimmed side only.
function node(features) {
  const all = features.map(f => ({ f, bbox: turf.bbox(f), points: rings(f).flat() }));
  for (const target of all) {
    const [w, s, e, n] = target.bbox;
    const candidates = all.filter(o => o !== target && o.bbox[0] <= e && o.bbox[2] >= w && o.bbox[1] <= n && o.bbox[3] >= s).flatMap(o => o.points);
    if (!candidates.length) continue;
    for (const ring of rings(target.f)) {
      for (let i = ring.length - 2; i >= 0; i--) {
        const a = ring[i], b = ring[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
        if (!len2) continue;
        const inside = [];
        for (const p of candidates) {
          if (p[0] < Math.min(a[0], b[0]) - 1e-9 || p[0] > Math.max(a[0], b[0]) + 1e-9 || p[1] < Math.min(a[1], b[1]) - 1e-9 || p[1] > Math.max(a[1], b[1]) + 1e-9) continue;
          const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
          if (t <= 1e-9 || t >= 1 - 1e-9) continue;
          const cross = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.sqrt(len2);
          if (cross < 1e-8) inside.push([t, p]);
        }
        if (!inside.length) continue;
        inside.sort((x, y) => x[0] - y[0]);
        const seen = new Set(), add = [];
        for (const [, p] of inside) { const k = key(p); if (!seen.has(k)) { seen.add(k); add.push(p); } }
        ring.splice(i + 1, 0, ...add);
      }
    }
  }
}

// zones: [{ id, family, geometry, clip }] in priority order (highest first). Returns { id: Feature }.
export function coverage({ zones, prio, together, smoothing, fail, where, intersect, difference }) {
  // 1. trim the drawn shapes, so zones of different families that share a page share an edge instead of overlapping
  const trimmed = {};
  for (const z of zones) {
    let g = turf.feature(z.geometry);
    for (const h of zones) {
      if (h.family === z.family || prio(h.family) >= prio(z.family) || !together(z.id, h.id)) continue;
      const cut = difference(g, trimmed[h.id]);
      if (!cut) fail(where, `zone "${z.id}": fully covered by "${h.id}"`);
      g = cut;
    }
    trimmed[z.id] = g;
  }
  let out = trimmed;
  if (smoothing) {
    // 2. one coverage: snap away float noise, give shared edges the same points, split into arcs
    const features = zones.map(z => {
      const f = trimmed[z.id];
      const coordinates = f.geometry.type === 'Polygon' ? f.geometry.coordinates.map(r => r.map(round)) : f.geometry.coordinates.map(p => p.map(r => r.map(round)));
      return { type: 'Feature', id: z.id, properties: {}, geometry: { type: f.geometry.type, coordinates } };
    });
    node(features);
    const topo = ts.topology({ zones: { type: 'FeatureCollection', features } });
    // 3. a node is an arc end that some other arc ends at too; a ring without nodes is one closed arc
    const ends = new Map();
    for (const arc of topo.arcs) for (const c of [arc[0], arc[arc.length - 1]]) ends.set(key(c), (ends.get(key(c)) ?? 0) + 1);
    topo.arcs = topo.arcs.map(arc => {
      const closed = key(arc[0]) === key(arc[arc.length - 1]) && ends.get(key(arc[0])) === 2;
      return chaikin(arc, smoothing, closed);
    });
    // 4. the zones again, from the rounded arcs
    out = {};
    for (const f of tc.feature(topo, topo.objects.zones).features) out[f.id] = turf.feature(f.geometry);
  }
  // 5. cut to land last, so coasts keep their detail
  const result = {};
  for (const z of zones) {
    const land = out[z.id] && near(z.clip, turf.bbox(out[z.id]));
    const g = land && intersect(out[z.id], land);
    if (!g) fail(where, `zone "${z.id}": nothing left after the land clip`);
    result[z.id] = g;
  }
  return result;
}
