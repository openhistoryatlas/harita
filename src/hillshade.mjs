// A transparent hillshade PNG from AWS terrain tiles, plus a .bbox.json beside it for the map.
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

const TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

// bbox is [west, south, east, north]. Writes out and out's .bbox.json, returns the bbox the raster covers.
export async function hillshade({ bbox, zoom = 7, out = 'geo/hillshade.png', log = console.log }) {
  const [W, S, E, N] = bbox;
  const OUT = path.resolve(out);
  const n = 2 ** zoom;
  const x2t = lon => Math.floor((lon + 180) / 360 * n);
  const y2t = lat => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
  const t2lon = x => x / n * 360 - 180;
  const t2lat = y => { const m = Math.PI - 2 * Math.PI * y / n; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(m) - Math.exp(-m))); };
  const x0 = x2t(W), x1 = x2t(E), y0 = y2t(N), y1 = y2t(S);
  const cols = x1 - x0 + 1, rows = y1 - y0 + 1, Wpx = cols * 256, Hpx = rows * 256;
  log(`${cols} x ${rows} tiles at zoom ${zoom}, ${Wpx} x ${Hpx} px before downsampling`);

  const elev = new Float32Array(Wpx * Hpx);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const res = await fetch(`${TILES}/${zoom}/${x}/${y}.png`);
    if (!res.ok) throw new Error(`tile ${zoom}/${x}/${y}: HTTP ${res.status}`);
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const k = (j * 256 + i) * 4;
      elev[((y - y0) * 256 + j) * Wpx + (x - x0) * 256 + i] = png.data[k] * 256 + png.data[k + 1] + png.data[k + 2] / 256 - 32768;
    }
  }

  // hillshade: sun from the north west, 45 degrees up, vertical exaggeration 2.5; sea stays transparent
  const midLat = (N + S) / 2;
  const cell = 156543 * Math.cos(midLat * Math.PI / 180) / n;
  const az = 315 * Math.PI / 180, alt = 45 * Math.PI / 180, base = Math.sin(alt);
  const g = (x, y) => elev[Math.min(Hpx - 1, Math.max(0, y)) * Wpx + Math.min(Wpx - 1, Math.max(0, x))];
  const full = new PNG({ width: Wpx, height: Hpx });
  for (let y = 0; y < Hpx; y++) for (let x = 0; x < Wpx; x++) {
    const k = (y * Wpx + x) * 4;
    if (g(x, y) <= 0) { full.data[k + 3] = 0; continue; }
    const dzdx = ((g(x + 1, y - 1) + 2 * g(x + 1, y) + g(x + 1, y + 1)) - (g(x - 1, y - 1) + 2 * g(x - 1, y) + g(x - 1, y + 1))) / (8 * cell);
    const dzdy = ((g(x - 1, y + 1) + 2 * g(x, y + 1) + g(x + 1, y + 1)) - (g(x - 1, y - 1) + 2 * g(x, y - 1) + g(x + 1, y - 1))) / (8 * cell);
    const slope = Math.atan(2.5 * Math.hypot(dzdx, dzdy)), aspect = Math.atan2(dzdy, -dzdx);
    const s = Math.max(0, Math.min(1, Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect)));
    if (s < base) { full.data[k] = 20; full.data[k + 1] = 15; full.data[k + 2] = 5; full.data[k + 3] = Math.round((base - s) / base * 170); }
    else { full.data[k] = 255; full.data[k + 1] = 255; full.data[k + 2] = 245; full.data[k + 3] = Math.round((s - base) / (1 - base) * 90); }
  }

  // downsample 2x and quantise alpha so the PNG stays small enough to inline
  const F = 2, w = Wpx / F, h = Hpx / F;
  const small = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, gg = 0, b = 0, a = 0;
    for (let j = 0; j < F; j++) for (let i = 0; i < F; i++) { const k = ((y * F + j) * Wpx + x * F + i) * 4, al = full.data[k + 3]; r += full.data[k] * al; gg += full.data[k + 1] * al; b += full.data[k + 2] * al; a += al; }
    const k = (y * w + x) * 4;
    if (!a) continue;
    small.data[k] = Math.round(r / a); small.data[k + 1] = Math.round(gg / a); small.data[k + 2] = Math.round(b / a); small.data[k + 3] = Math.round(a / (F * F) / 12) * 12;
  }
  const covered = { w: t2lon(x0), s: t2lat(y1 + 1), e: t2lon(x1 + 1), n: t2lat(y0), px: [w, h] };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, PNG.sync.write(small, { deflateLevel: 9 }));
  fs.writeFileSync(OUT.replace(/\.png$/, '.bbox.json'), JSON.stringify(covered));
  log(`wrote ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB, ${w} x ${h} px) and its .bbox.json`);
  return covered;
}
