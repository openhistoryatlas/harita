// Builds a copy of example/ and checks the output, then breaks the copy in the ways the build must catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import { build, patterns, schema } from '../src/index.mjs';
import { cut, terrainPlan, BASE_ZOOM } from '../src/terrain.mjs';

const EXAMPLE = fileURLToPath(new URL('../example/', import.meta.url));
const STORY = 'content/settlement-of-iceland';
const quiet = () => {};
function copy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harita-'));
  fs.cpSync(EXAMPLE, root, { recursive: true });
  return root;
}
// a stand-in for the elevation download: the same tile everywhere, a slope from 200 m below the sea to 820 m
const terrarium = h => { const png = new PNG({ width: 256, height: 256 }); for (let k = 0; k < 256 * 256; k++) { const v = h(k % 256, k >> 8) + 32768; png.data.set([Math.floor(v / 256), Math.floor(v) % 256, Math.round((v % 1) * 256), 255], k * 4); } return PNG.sync.write(png); };
const TILE = terrarium(x => x * 4 - 200);
const CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'harita-cache-'));
let fetched = 0;
const elevation = async () => { fetched++; return TILE; };
const make = (root, opts = {}) => build({ root, log: quiet, cache: CACHE, elevation, ...opts });
const bundleOf = (root, id = 'settlement-of-iceland') => { const html = fs.readFileSync(path.join(root, 'dist', id, 'index.html'), 'utf8'), i = html.indexOf('const BUNDLE = ') + 15; return JSON.parse(html.slice(i, html.indexOf(';\n', i))); };
const append = (root, file, text) => fs.appendFileSync(path.join(root, file), '\n' + text + '\n');
const edit = (root, file, from, to) => fs.writeFileSync(path.join(root, file), fs.readFileSync(path.join(root, file), 'utf8').replace(from, to));

test('build writes the site index and one page per story', async () => {
  const root = copy(), lines = [];
  const r = await make(root, { log: l => lines.push(l) });
  assert.equal(r.dist, path.join(root, 'dist'));
  assert.deepEqual(r.stories.map(s => [s.id, s.pages]), [['settlement-of-iceland', 3]]);
  const page = fs.readFileSync(path.join(root, 'dist/settlement-of-iceland/index.html'), 'utf8');
  assert.ok(page.includes('const BUNDLE = {"id":"settlement-of-iceland"'));
  assert.ok(page.includes('Þingvellir'));
  assert.match(page, /--land-0:#[0-9a-f]{6};--land-1:#[0-9a-f]{6};/);
  assert.ok(page.includes('"name":"Iceland","tint":0'));
  assert.match(page, /"labels":\[\{"type":"Feature","properties":\{"en":"Ísland","rank":-\d+\},"geometry":\{"type":"Point","coordinates":\[-1\d\.\d+,6[45]\.\d+\]/);
  assert.ok(page.includes('"emblem":{"type":"FeatureCollection","features":[{"type":"Feature"'));
  assert.ok(page.includes('"properties":{"color":"#c62828"}'));
  assert.ok(fs.existsSync(path.join(root, 'dist/terrain/0/0/0.png')));
  assert.ok(page.includes('"tiles":"../terrain/{z}/{x}/{y}.png"'));
  assert.ok(Object.values(bundleOf(root).zones).every(z => Number.isInteger(z.area) && z.area > 0), 'each zone ships its area in km2');
  const index = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  assert.ok(index.includes('const SITE = {"title":{"en":"Example histories"}'));
  for (const html of [page, index]) assert.ok(html.includes("const REPO = 'https://github.com/openhistoryatlas/harita';"));
  assert.ok(lines.includes('wrote dist/index.html (1 stories)'));
});

test('a misspelt key names the file and the field', async () => {
  const root = copy();
  append(root, `${STORY}/pages/010-landnam/page.yaml`, 'markres: []');
  await assert.rejects(make(root), /010-landnam\/page\.yaml:\n\s+\(root\): Unrecognized key: "markres"/);
});

test('a reference to a zone no file defines fails', async () => {
  const root = copy();
  edit(root, `${STORY}/pages/020-althing/page.yaml`, 'zones: [island]', 'zones: [mainland]');
  await assert.rejects(make(root), /020-althing\/page\.yaml: unknown zone "mainland"/);
});

test('a page dated after the page that follows it fails', async () => {
  const root = copy();
  append(root, `${STORY}/pages/020-althing/page.yaml`, 'when: 1100');
  await assert.rejects(make(root), /030-kristnitaka starts 1000-01-01, before .*020-althing which starts 1100-01-01/);
});

test('emblem features are coloured by family and named for the hover label', async () => {
  const root = copy(), plugin = path.join(root, 'plugins/emblems/ring.mjs');
  fs.writeFileSync(plugin, fs.readFileSync(plugin, 'utf8').replace("properties: { color }", "properties: { color, family: 'settled', id: 'ring', name: 'The Althing' }"));
  await make(root);
  const page = bundleOf(root).pages.find(p => p.emblem);
  assert.deepEqual(page.emblem.features[0].properties, { color: '#c62828', family: 'settled', id: 'ring' });
  assert.deepEqual(page.emblemNames, { ring: { en: 'The Althing' } });
});

test('a story sets how close the map zooms, 11 by default', async () => {
  const root = copy(), story = path.join(root, 'content/settlement-of-iceland/story.yaml');
  await make(root);
  assert.equal(bundleOf(root).maxZoom, 11);
  fs.appendFileSync(story, 'max_zoom: 14\n');
  await make(root);
  assert.equal(bundleOf(root).maxZoom, 14);
});

test('a named emblem feature without an id fails', async () => {
  const root = copy(), plugin = path.join(root, 'plugins/emblems/ring.mjs');
  fs.writeFileSync(plugin, fs.readFileSync(plugin, 'utf8').replace("properties: { color }", "properties: { color, name: 'The Althing' }"));
  await assert.rejects(make(root), /emblem feature named "The Althing" needs an id/);
});

test('an emblem kind without a plugin file fails', async () => {
  const root = copy();
  edit(root, `${STORY}/pages/030-kristnitaka/page.yaml`, 'kind: ring', 'kind: halo');
  await assert.rejects(make(root), /030-kristnitaka\/page\.yaml emblem: unknown emblem kind "halo", add plugins\/emblems\/halo\.mjs/);
});

test('a plugin that rejects its parameters fails with its own message', async () => {
  const root = copy();
  edit(root, `${STORY}/pages/030-kristnitaka/page.yaml`, 'radius_km: 12', 'radius_km: 0');
  await assert.rejects(make(root), /ring needs center \[lon, lat\] and radius_km/);
});

test('a zone clip naming a country the story does not draw fails', async () => {
  const root = copy();
  edit(root, `${STORY}/pages/020-althing/zones/island.geojson`, '"clip": ["Iceland"]', '"clip": ["Greenland"]');
  await assert.rejects(make(root), /island\.geojson: clip country "Greenland" is not in the story's countries/);
});

test('a label override for a country the story does not draw fails', async () => {
  const root = copy();
  edit(root, `${STORY}/story.yaml`, 'names: { Iceland:', 'names: { Greenland:');
  await assert.rejects(make(root), /labels name "Greenland" is not in countries/);
});

test('a folder without content is refused', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harita-empty-'));
  await assert.rejects(make(root), /content\/: no story\.yaml found/);
});

test('patterns finds families that look alike and fixes one with a pattern', async () => {
  const root = copy();
  edit(root, `${STORY}/story.yaml`, 'smoothing: 4', '  church: { priority: 1, color: "#2f6aa0", color_dark: "#6fa3d7" }\nsmoothing: 4');
  fs.mkdirSync(path.join(root, `${STORY}/pages/030-kristnitaka/zones`));
  fs.writeFileSync(path.join(root, `${STORY}/pages/030-kristnitaka/zones/church.geojson`), JSON.stringify({
    type: 'Feature', properties: { family: 'church', name: 'Church land' },
    geometry: { type: 'Polygon', coordinates: [[[-22, 64], [-21, 64], [-21, 64.5], [-22, 64.5], [-22, 64]]] },
  }));
  edit(root, `${STORY}/pages/030-kristnitaka/page.yaml`, 'zones: [island]', 'zones: [island, church]');
  const before = patterns({ root, log: quiet });
  assert.equal(before.length, 1);
  assert.equal(before[0].story, 'settlement-of-iceland');
  assert.deepEqual([before[0].a, before[0].b, before[0].fix, before[0].suggestion], ['church', 'settled', 'church', 'hatch']);
  assert.deepEqual(patterns({ root, fix: true, log: quiet }), []);
  assert.match(fs.readFileSync(path.join(root, `${STORY}/story.yaml`), 'utf8'), /church: \{ .*, pattern: hatch \}/);
  assert.deepEqual(patterns({ root, log: quiet }), []);
});

test('schema fills defaults and lists every bad field at once', async () => {
  const page = schema.check(schema.Page, { date: '930', title: 'x', bbox: [-25, 63, -13, 67] }, 'page.yaml');
  assert.deepEqual([page.zones, page.routes, page.markers, page.sources, page.images], [[], [], [], [], {}]);
  assert.throws(() => schema.check(schema.Story, { id: 'Bad Id', title: 'x' }, 'story.yaml'), err => {
    assert.match(err.message, /^story\.yaml:\n/);
    assert.match(err.message, /\n  id: lowercase letters/);
    assert.match(err.message, /\n  languages: /);
    return true;
  });
});

test('a language harita does not ship gets an interface catalogue and counts its gaps', async () => {
  const { i18n } = await import('../src/index.mjs');
  const root = copy();
  edit(root, `${STORY}/story.yaml`, 'languages: [en]', 'languages: [en, de]');
  for (const f of fs.readdirSync(path.join(root, STORY, 'pages'), { recursive: true })) if (f.endsWith('en.md')) fs.copyFileSync(path.join(root, STORY, 'pages', f), path.join(root, STORY, 'pages', f.replace(/en\.md$/, 'de.md')));
  i18n({ root, lang: 'de', log: quiet });
  const ui = fs.readFileSync(path.join(root, 'i18n/ui/de.yaml'), 'utf8');
  assert.match(ui, /# Prev\nprev: ""/);
  assert.match(ui, /themes\.cool: ""/);
  const lines = [];
  await make(root, { log: l => lines.push(l) });
  assert.ok(lines.some(l => /de interface: 0 of \d+ strings translated/.test(l)));
  // with the content translated, the interface is what --strict still stops on
  const cat = path.join(root, STORY, 'i18n/de.yaml');
  fs.writeFileSync(cat, fs.readFileSync(cat, 'utf8').replace(/: ""$/gm, ': "x"'));
  await assert.rejects(make(root, { strict: true }), /de interface: \d+ strings missing/);
});

// zones meeting at one point: after rounding, no uncovered pocket at the junction and none along shared edges
async function junction(root, page, specs) {
  const dir = path.join(root, STORY, 'shared/zones');
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, family, ring] of specs) fs.writeFileSync(path.join(dir, id + '.geojson'), JSON.stringify({ type: 'Feature', properties: { id, family, name: id }, geometry: { type: 'Polygon', coordinates: [ring] } }));
  edit(root, `${STORY}/pages/${page}/page.yaml`, 'zones: [island]', `zones: [${specs.map(s => s[0]).join(', ')}]`);
  await make(root);
  const B = bundleOf(root);
  return specs.map(s => B.zones[s[0]].geometry);
}
const holes = async geoms => {
  const turf = await import('@turf/turf');
  const u = turf.union(turf.featureCollection(geoms.map(g => turf.feature(g))));
  return (u.geometry.type === 'Polygon' ? [u.geometry.coordinates] : u.geometry.coordinates).flatMap(r => r.slice(1)).length;
};
const covers = async (geoms, pt) => { const turf = await import('@turf/turf'); return geoms.some(g => turf.booleanPointInPolygon(turf.point(pt), turf.feature(g))); };

test('six zones meeting at a point keep one shared edge each after rounding', async () => {
  const root = copy(), c = [-18.5, 64.9];
  const p = k => [c[0] + 0.6 * Math.cos(k * Math.PI / 3), c[1] + 0.25 * Math.sin(k * Math.PI / 3)];
  const geoms = await junction(root, '030-kristnitaka', [0, 1, 2, 3, 4, 5].map(k => [`w${k}`, 'settled', [c, p(k), p(k + 1), c]]));
  assert.equal(geoms.length, 6);
  assert.equal(await holes(geoms), 0, 'a pocket is left between the zones');
  assert.ok(await covers(geoms, c), 'the junction itself is uncovered');
  assert.ok(await covers(geoms, [c[0] + 0.3, c[1] + 0.001]), 'a gap opened along a shared edge');
});

test('four zones of two families meeting at a point leave no gap and do not overlap', async () => {
  const root = copy(), [x, y] = [-18.5, 64.9], d = 0.05;
  edit(root, `${STORY}/story.yaml`, 'families:\n', 'families:\n  held: { priority: 1, color: "#c62828" }\n');
  const box = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
  // drawn the way content is drawn: each zone reaches a little past the centre into its neighbours
  const geoms = await junction(root, '030-kristnitaka', [
    ['ne', 'settled', box(x - d, y - d / 4, x + 0.6, y + 0.25)], ['sw', 'settled', box(x - 0.6, y - 0.25, x + d, y + d / 4)],
    ['nw', 'held', box(x - 0.6, y - d / 4, x + d, y + 0.25)], ['se', 'held', box(x - d, y - 0.25, x + 0.6, y + d / 4)],
  ]);
  assert.equal(await holes(geoms), 0, 'a pocket is left between the zones');
  assert.ok(await covers(geoms, [x, y]), 'the junction itself is uncovered');
});

test('a battle page opens in 3D when its view is close, and camera: false keeps it flat', async () => {
  const root = copy(), pages = `${STORY}/pages`;
  fs.writeFileSync(path.join(root, STORY, 'shared/battles.yaml'), 'skirmish:\n  lnglat: [-21.9, 64.1]\n  name: A skirmish\n  date: "900"\n  sides: [{ name: Settlers }]\n');
  append(root, `${pages}/010-landnam/page.yaml`, 'battle: skirmish');
  append(root, `${pages}/020-althing/page.yaml`, 'battle: skirmish');
  edit(root, `${pages}/020-althing/page.yaml`, 'bbox: [-25, 63, -13, 67]', 'bbox: [-40, 55, -5, 70]');
  await make(root);
  assert.deepEqual(bundleOf(root).pages.map(p => p.camera), [{ pitch: 50, bearing: 0, exaggeration: 2 }, null, { pitch: 55, bearing: 40, exaggeration: 2 }]);
  append(root, `${pages}/010-landnam/page.yaml`, 'camera: false');
  await make(root);
  assert.equal(bundleOf(root).pages[0].camera, null);
});

test('a language written right to left ships dir rtl, English ltr', async () => {
  const root = copy();
  edit(root, `${STORY}/story.yaml`, 'languages: [en]', 'languages: [en, ar]');
  for (const f of fs.readdirSync(path.join(root, STORY, 'pages'), { recursive: true })) if (f.endsWith('en.md')) fs.copyFileSync(path.join(root, STORY, 'pages', f), path.join(root, STORY, 'pages', f.replace(/en\.md$/, 'ar.md')));
  await make(root);
  const { ui } = bundleOf(root);
  assert.deepEqual([ui.en.dir, ui.ar.dir], ['ltr', 'rtl']);
});

test('neighbouring countries get different land tints', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harita-tints-')), story = path.join(root, 'content/benelux');
  fs.mkdirSync(path.join(story, 'pages/010-start/text'), { recursive: true });
  fs.writeFileSync(path.join(story, 'story.yaml'), 'id: benelux\ntitle: Benelux\nlanguages: [en]\nextent: [2, 49, 8, 54]\nland: [Belgium]\ncountries: [Belgium, Netherlands, Luxembourg, Germany, France]\nfamilies: {}\n');
  fs.writeFileSync(path.join(story, 'pages/010-start/page.yaml'), 'date: "1830"\ntitle: Independence\nbbox: [2, 49, 8, 54]\n');
  fs.writeFileSync(path.join(story, 'pages/010-start/text/en.md'), 'Belgium breaks away from the Netherlands.\n');
  await make(root);
  const tint = Object.fromEntries(bundleOf(root, 'benelux').topo.objects.countries.geometries.map(g => [g.properties.name, g.properties.tint]));
  const borders = [['Belgium', 'Netherlands'], ['Belgium', 'Luxembourg'], ['Belgium', 'Germany'], ['Belgium', 'France'], ['Netherlands', 'Germany'], ['Luxembourg', 'Germany'], ['Luxembourg', 'France'], ['Germany', 'France']];
  for (const [a, b] of borders) assert.notEqual(tint[a], tint[b], `${a} and ${b} share tint ${tint[a]}`);
});

test('elevation tiles keep land heights to the metre and flatten the sea', () => {
  const out = PNG.sync.read(cut(terrarium((x, y) => y < 128 ? -35.6 : 1234.4 + x / 256)));
  const at = (x, y) => { const k = (y * 256 + x) * 4; return out.data[k] * 256 + out.data[k + 1] + out.data[k + 2] / 256 - 32768; };
  assert.deepEqual([at(10, 10), at(10, 200), at(250, 200)], [0, 1234, 1235]);
});

test('relief tiles go one zoom past the map, at most to zoom 15 where the source ends', () => {
  const field = [[-71.235, 42.447, -71.225, 42.452]];
  assert.equal(terrainPlan([-72, 42, -70, 43], field).maxzoom, 12);
  assert.equal(terrainPlan([-72, 42, -70, 43], field, 13).maxzoom, 14);
  assert.equal(terrainPlan([-72, 42, -70, 43], field, 16).maxzoom, 15);
});

test('a page that zooms in gets elevation tiles above the base zoom, the rest of the extent does not', () => {
  const plan = terrainPlan([-25, 63, -13, 67], [[-25, 63, -13, 67], [-21.3, 64.15, -20.9, 64.35]]);
  const zooms = Object.keys(plan.ranges).map(Number);
  assert.equal(Math.min(...zooms), 0);
  assert.ok(plan.maxzoom > BASE_ZOOM + 1, `maxzoom ${plan.maxzoom}`);
  const [x0, y0, x1, y1] = plan.ranges[plan.maxzoom][0], n = 2 ** plan.maxzoom;
  assert.ok((x1 - x0 + 1) * (y1 - y0 + 1) < 50, 'the zoomed page asks for a small area');
  assert.ok(x0 / n * 360 - 180 > -21.5 && (x1 + 1) / n * 360 - 180 < -20.7);
  assert.match(plan.credits[0], /Natural Earth/);
  assert.ok(plan.credits.some(c => c.includes('U.S. Geological Survey')));
  assert.ok(!plan.credits.some(c => c.includes('INEGI')), 'Mexico is far from Iceland');
});

test('a page camera reaches the map, and a second build reads the tiles from the cache', async () => {
  const root = copy();
  await make(root);
  assert.deepEqual(bundleOf(root).pages.map(p => p.camera), [null, null, { pitch: 55, bearing: 40, exaggeration: 2 }]);
  const before = fetched;
  await make(root);
  assert.equal(fetched, before);
  edit(root, `${STORY}/pages/030-kristnitaka/page.yaml`, 'pitch: 55', 'pitch: 80');
  await assert.rejects(make(root), /camera\.pitch: Too big: expected number to be <=60/);
});

test('names, citations and credits show in the source language until a catalogue translates them', async () => {
  const { i18n } = await import('../src/index.mjs');
  const root = copy();
  edit(root, `${STORY}/story.yaml`, 'languages: [en]', 'languages: [en, tr]');
  for (const f of fs.readdirSync(path.join(root, STORY, 'pages'), { recursive: true })) if (f.endsWith('en.md')) fs.copyFileSync(path.join(root, STORY, 'pages', f), path.join(root, STORY, 'pages', f.replace(/en\.md$/, 'tr.md')));
  fs.writeFileSync(path.join(root, STORY, 'shared/battles.yaml'), 'skirmish:\n  lnglat: [-21.9, 64.1]\n  name: A skirmish\n  date: "900"\n  sides: [{ name: Settlers, commanders: [Ingólfr Arnarson] }]\n');
  append(root, `${STORY}/pages/010-landnam/page.yaml`, 'battle: skirmish');
  i18n({ root, lang: 'tr', log: quiet });
  const cat = path.join(root, STORY, 'i18n/tr.yaml'), text = fs.readFileSync(cat, 'utf8');
  assert.doesNotMatch(text, /markers\.reykjavik\.label|commanders\.0/);
  fs.writeFileSync(cat, text.replace(/: ""$/gm, ': "x"') + '\nmarkers.thingvellir.label: "Thingvellir"\n');
  await make(root, { strict: true });
  const b = bundleOf(root);
  assert.equal(b.battles.skirmish.sides[0].commanders[0].tr, 'Ingólfr Arnarson');
  assert.equal(b.markers.reykjavik.label.tr, 'Reykjavík');
  assert.equal(b.markers.thingvellir.label.tr, 'Thingvellir');
  // regenerating keeps the one name with its own form, at the end
  i18n({ root, lang: 'tr', log: quiet });
  assert.match(fs.readFileSync(cat, 'utf8'), /# Names, citations and credits[^\n]*\n\n# Þingvellir\nmarkers\.thingvellir\.label: "Thingvellir"/);
});
