// Natural Earth countries at 1:10m, the borders and land every story and the zone comparison draw on.
import fs from 'fs';
import { createRequire } from 'module';
import * as tc from 'topojson-client';

const require = createRequire(import.meta.url);
// Natural Earth countries, parsed on the first build so that importing the package stays cheap
// scale 10m for the maps, 50m where a coast a kilometre off does not matter, such as comparing zones
const worldFeatures = {};
export const world = (scale = '10m') => {
  if (!worldFeatures[scale]) { const w = JSON.parse(fs.readFileSync(require.resolve(`world-atlas/countries-${scale}.json`))); worldFeatures[scale] = tc.feature(w, w.objects.countries).features.map(f => ({ ...f, geometry: f.geometry && unwrap(f.geometry) })); }
  return worldFeatures[scale];
};
// Russia has a ring that jumps from 180 to -180 and back, which a planar clip reads as edges across the whole map.
// The ring runs on past 180 instead, with a copy a turn to the west for the part beyond the antimeridian.
const unwrapRing = ring => {
  let shift = 0;
  const out = [];
  for (const [x, y] of ring) {
    const step = x + shift - (out.at(-1)?.[0] ?? x + shift);
    if (Math.abs(step) > 180) shift -= Math.sign(step) * 360;
    out.push([x + shift, y]);
  }
  return shift === 0 ? out : ring;   // a ring round the pole does not close when unwrapped, so it stays as it is
};
function unwrap(geometry) {
  const polys = [];
  for (const p of geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) {
    const rings = p.map(unwrapRing), xs = rings[0].map(c => c[0]);
    polys.push(rings);
    const east = xs.reduce((a, b) => Math.max(a, b)), west = xs.reduce((a, b) => Math.min(a, b));
    if (east > 180) polys.push(rings.map(r => r.map(([x, y]) => [x - 360, y])));
    if (west < -180) polys.push(rings.map(r => r.map(([x, y]) => [x + 360, y])));
  }
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}
