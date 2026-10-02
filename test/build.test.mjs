// Builds a copy of example/ and checks the output, then breaks the copy in the ways the build must catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { build, patterns, schema } from '../src/index.mjs';

const EXAMPLE = fileURLToPath(new URL('../example/', import.meta.url));
const STORY = 'content/settlement-of-iceland';
const quiet = () => {};
function copy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harita-'));
  fs.cpSync(EXAMPLE, root, { recursive: true });
  return root;
}
const append = (root, file, text) => fs.appendFileSync(path.join(root, file), '\n' + text + '\n');
const edit = (root, file, from, to) => fs.writeFileSync(path.join(root, file), fs.readFileSync(path.join(root, file), 'utf8').replace(from, to));

test('build writes the site index and one page per story', () => {
  const root = copy(), lines = [];
  const r = build({ root, log: l => lines.push(l) });
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
  assert.ok(fs.existsSync(path.join(root, 'dist/settlement-of-iceland/hillshade.png')));
  const index = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  assert.ok(index.includes('const SITE = {"title":{"en":"Example histories"}'));
  for (const html of [page, index]) assert.ok(html.includes("const REPO = 'https://github.com/openhistoryatlas/harita';"));
  assert.ok(lines.includes('wrote dist/index.html (1 stories)'));
});

test('a misspelt key names the file and the field', () => {
  const root = copy();
  append(root, `${STORY}/pages/010-landnam/page.yaml`, 'markres: []');
  assert.throws(() => build({ root, log: quiet }), /010-landnam\/page\.yaml:\n\s+\(root\): Unrecognized key: "markres"/);
});

test('a reference to a zone no file defines fails', () => {
  const root = copy();
  edit(root, `${STORY}/pages/020-althing/page.yaml`, 'zones: [island]', 'zones: [mainland]');
  assert.throws(() => build({ root, log: quiet }), /020-althing\/page\.yaml: unknown zone "mainland"/);
});

test('a page dated after the page that follows it fails', () => {
  const root = copy();
  append(root, `${STORY}/pages/020-althing/page.yaml`, 'when: 1100');
  assert.throws(() => build({ root, log: quiet }), /030-kristnitaka starts 1000-01-01, before .*020-althing which starts 1100-01-01/);
});

test('an emblem kind without a plugin file fails', () => {
  const root = copy();
  edit(root, `${STORY}/pages/030-kristnitaka/page.yaml`, 'kind: ring', 'kind: halo');
  assert.throws(() => build({ root, log: quiet }), /030-kristnitaka\/page\.yaml emblem: unknown emblem kind "halo", add plugins\/emblems\/halo\.mjs/);
});

test('a plugin that rejects its parameters fails with its own message', () => {
  const root = copy();
  edit(root, `${STORY}/pages/030-kristnitaka/page.yaml`, 'radius_km: 12', 'radius_km: 0');
  assert.throws(() => build({ root, log: quiet }), /ring needs center \[lon, lat\] and radius_km/);
});

test('a zone clip naming a country the story does not draw fails', () => {
  const root = copy();
  edit(root, `${STORY}/pages/020-althing/zones/island.geojson`, '"clip": ["Iceland"]', '"clip": ["Greenland"]');
  assert.throws(() => build({ root, log: quiet }), /island\.geojson: clip country "Greenland" is not in the story's countries/);
});

test('a label override for a country the story does not draw fails', () => {
  const root = copy();
  edit(root, `${STORY}/story.yaml`, 'names: { Iceland:', 'names: { Greenland:');
  assert.throws(() => build({ root, log: quiet }), /labels name "Greenland" is not in countries/);
});

test('a folder without content is refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harita-empty-'));
  assert.throws(() => build({ root, log: quiet }), /content\/: no story\.yaml found/);
});

test('patterns finds families that look alike and fixes one with a pattern', () => {
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

test('schema fills defaults and lists every bad field at once', () => {
  const page = schema.check(schema.Page, { date: '930', title: 'x', bbox: [-25, 63, -13, 67] }, 'page.yaml');
  assert.deepEqual([page.zones, page.routes, page.markers, page.sources, page.images], [[], [], [], [], {}]);
  assert.throws(() => schema.check(schema.Story, { id: 'Bad Id', title: 'x' }, 'story.yaml'), err => {
    assert.match(err.message, /^story\.yaml:\n/);
    assert.match(err.message, /\n  id: lowercase letters/);
    assert.match(err.message, /\n  languages: /);
    return true;
  });
});
