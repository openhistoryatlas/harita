// Walk content/<story>/, clean the geometry, render the texts, and write dist/.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import yaml from 'js-yaml';
import { marked } from 'marked';
import * as turf from '@turf/turf';
import * as tc from 'topojson-client';
import * as ts from 'topojson-server';
import polylabel from 'polylabel';
import { check, Site, Story, Group, Page, Camera, Markers, Battles, Images, Zone, Route, Themes, BattlePlan } from './schema.mjs';
import { alikePairs, describe } from './palette.mjs';
import { loadCatalogues, translator, flatten, unflatten } from './i18n.mjs';
import { coverage } from './coverage.mjs';
import { terrainPlan, tileKeys, terrainTiles, openZoom } from './terrain.mjs';
import { esc, siteContext, storyFiles, siteFiles } from './pages.mjs';

// PKG is this package. The content project comes in as the root of each build.
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const REPO = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
const COMMON = fs.readFileSync(path.join(PKG, 'src', 'common.js'), 'utf8').replace('/*__REPO__*/', REPO);
// the story page shell, and the script every story page shares as dist/harita.js
const APP = fs.readFileSync(path.join(PKG, 'src', 'app.html'), 'utf8');
const APP_JS = COMMON + '\n' + fs.readFileSync(path.join(PKG, 'src', 'app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(PKG, 'src', 'index.html'), 'utf8').replace('/*__COMMON__*/', COMMON);
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
// a script's version in its URL, so a browser holding the last release's copy fetches the new one
const version = text => hash(text).slice(0, 10);
// the shape of the main page card kept in the cache. A card of another shape counts as no cache.
const CARD_FORMAT = 2;
// Cache files are written whole and renamed into place, so a build running at the same time reads the old file or
// the new one. A file that is missing or does not parse counts as no cache.
const readCache = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const writeCache = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}`; fs.writeFileSync(tmp, JSON.stringify(value)); fs.renameSync(tmp, file); };
// the code and libraries the cleaned zones come from, part of each story's zone cache key
const GEOMETRY_CODE = hash(['build.mjs', 'coverage.mjs'].map(f => fs.readFileSync(path.join(PKG, 'src', f), 'utf8'))
  .concat(['@turf/turf', 'world-atlas', 'topojson-server', 'topojson-client'].map(m => require(m + '/package.json').version)));
const UI_DIR = path.join(PKG, 'src', 'i18n');
const UI = Object.fromEntries(fs.readdirSync(UI_DIR).filter(f => f.endsWith('.yaml')).map(f => [f.replace(/\.yaml$/, ''), yaml.load(fs.readFileSync(path.join(UI_DIR, f), 'utf8'))]));
// Natural Earth countries, parsed on the first build so that importing the package stays cheap
let worldFeatures = null;
const world = () => { if (!worldFeatures) { const w = JSON.parse(fs.readFileSync(require.resolve('world-atlas/countries-10m.json'))); worldFeatures = tc.feature(w, w.objects.countries).features; } return worldFeatures; };
// Marker icons come from Lucide; the names the first stories used before map onto it
const ICON_DIR = path.dirname(require.resolve('lucide-static/icons/flag.svg'));
const LEGACY_ICONS = { congress: 'users', scroll: 'scroll-text', building: 'landmark' };
function iconSvg(name, where) {
  const file = path.join(ICON_DIR, name + '.svg');
  if (!exists(file)) fail(where, `unknown icon "${name}", pick a name from https://lucide.dev/icons`);
  return fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\s*class="[^"]*"/, '').replace(/\s+/g, ' ').replace(/> </g, '><').trim();
}

const fail = (where, msg) => { throw new Error(`${where}: ${msg}`); };
const exists = p => fs.existsSync(p);
const listDirs = p => exists(p) ? fs.readdirSync(p).filter(d => fs.statSync(path.join(p, d)).isDirectory()).sort() : [];
const listFiles = (p, ext) => exists(p) ? fs.readdirSync(p).filter(f => f.endsWith(ext)).sort() : [];
const km2 = f => turf.area(f) / 1e6;
const intersect = (a, b) => turf.intersect(turf.featureCollection([a, b]));
const boxesMeet = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const difference = (a, b) => turf.difference(turf.featureCollection([a, b]));
const idOf = name => name.replace(/^\d+-/, '');
const writeFile = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

const emptyText = langs => Object.fromEntries(langs.map(l => [l, '']));
// A when value with the missing parts rounded down for from and up for to.
const whenEdge = (s, isEnd) => { const [y, m, d] = s.split('-'); return `${y}-${m ?? (isEnd ? '12' : '01')}-${d ?? (isEnd ? '31' : '01')}`; };
// Interface strings for a language: the package file, else English, with the project's i18n/ui/<lang>.yaml laid over it.
// Interface keys: every string harita ships in English, plus a name for each theme the site offers.
const uiOwn = (root, l) => { const f = path.join(root, 'i18n', 'ui', l + '.yaml'); return exists(f) ? flatten(yaml.load(fs.readFileSync(f, 'utf8')) ?? {}) : {}; };
export function uiCatalogue(root, lang, themes) {
  const en = flatten(UI.en);
  const entries = Object.keys(en).filter(k => !k.startsWith('themes.')).map(key => ({ key, source: en[key], shared: false, inline: null }))
    .concat(Object.entries(themes).map(([id, t]) => ({ key: `themes.${id}`, source: en[`themes.${id}`] ?? (typeof t.name === 'string' ? t.name : t.name?.en) ?? id, shared: false, inline: null })));
  // a theme that still carries an inline name for this language counts as translated
  const inlineNames = Object.fromEntries(Object.entries(themes).filter(([, t]) => typeof t.name === 'object' && t.name?.[lang]).map(([id, t]) => [`themes.${id}`, t.name[lang]]));
  const have = { ...inlineNames, ...flatten(UI[lang] ?? {}), ...uiOwn(root, lang) };
  return { entries, existing: have, missing: entries.filter(e => !have[e.key]).map(e => e.key), shipped: Object.keys(flatten(UI[lang] ?? {})).length > 0 };
}
// dir is the language's writing direction, from ICU; Node before 23 has textInfo, later ones getTextInfo()
const textDir = l => { const loc = new Intl.Locale(l); return (loc.getTextInfo?.() ?? loc.textInfo).direction; };
function uiFor(langs, root) {
  // a missing key falls back to English alone
  return Object.fromEntries(langs.map(l => [l, { ...unflatten({ ...flatten(UI.en), ...flatten(UI[l] ?? {}), ...uiOwn(root, l) }), dir: textDir(l) }]));
}
const themeList = (themes, ui, langs) => Object.entries(themes).map(([id, t]) => ({ id, name: Object.fromEntries(langs.map(l => [l, ui[l].themes?.[id] ?? (typeof t.name === 'string' ? t.name : t.name?.[l] ?? t.name?.en) ?? id])) }));

// The content project of one build: its folders, its logger, and readers that name files relative to it.
function project(root, log) {
  const rel = p => path.relative(root, p);
  const loadYaml = p => { try { return yaml.load(fs.readFileSync(p, 'utf8')) ?? {}; } catch (e) { fail(rel(p), e.message); } };
  const readYaml = (p, schema) => check(schema, loadYaml(p), rel(p));
  const readJson = (p, schema) => check(schema, JSON.parse(fs.readFileSync(p, 'utf8')), rel(p));
  return { root, content: path.join(root, 'content'), dist: path.join(root, 'dist'), log, rel, loadYaml, readYaml, readJson };
}

const LAND_SLOTS = 8;
// CSS for every theme: tokens on :root[data-palette=id], light and dark; the default theme also on bare :root
function themeCss(themes, defaultId) {
  const TOKEN = { paper: '--paper', paper2: '--paper-2', sea: '--sea', ink: '--ink', ink2: '--ink-2', rule: '--rule', accent: '--accent', panel: '--panel', route: '--route', border: '--border' };
  const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  // eight land slots always, filled up from paper2, so a theme without tints paints one colour and never inherits another theme's
  const land = set => [...Array(LAND_SLOTS)].map((_, i) => `--land-${i}:${set.land?.[i % set.land.length] ?? set.paper2};`).join('');
  const decl = set => Object.entries(set).filter(([k]) => TOKEN[k]).map(([k, v]) => `${TOKEN[k]}:${v};`).join('') + land(set) + (lum(set.paper) < 0.5 ? 'color-scheme:dark;' : 'color-scheme:light;');
  const block = (sel, t) => `${sel}{${decl(t.light)}}@media (prefers-color-scheme: dark){${sel}:not([data-theme="light"]){${decl(t.dark)}}}${sel}[data-theme="dark"]{${decl(t.dark)}}`;
  return block(':root', themes[defaultId]) + Object.entries(themes).map(([id, t]) => block(`:root[data-palette="${id}"]`, t)).join('');
}

// An emblem kind is plugins/emblems/<kind>.mjs in the content project, else src/emblems/<kind>.mjs here, so a story
// can replace a built-in kind. The file exports a function (params, { turf, families }) => GeoJSON FeatureCollection,
// drawn as a fill layer: a feature takes its "family" colour for the theme, else its "color". Features that share an
// "id" highlight together, and a "name" shows when the reader points at one. Node 22.12+ loads an ES module through
// require synchronously, which keeps the build synchronous.
const EMBLEM_DIR = path.join(PKG, 'src', 'emblems');
const BUILT_IN_EMBLEMS = { 'battle-plan': BattlePlan }; // each built-in kind with the schema of its parameters
function emblemFor(root, spec, where, { families, T, pid }) {
  const own = path.join(root, 'plugins', 'emblems', spec.kind + '.mjs'), builtIn = path.join(EMBLEM_DIR, spec.kind + '.mjs');
  const file = exists(own) ? own : exists(builtIn) ? builtIn
    : fail(where, `unknown emblem kind "${spec.kind}", add plugins/emblems/${spec.kind}.mjs or use one harita ships: ${Object.keys(BUILT_IN_EMBLEMS).join(', ')}`);
  const plugin = require(file).default;
  if (typeof plugin !== 'function') fail(where, `plugins/emblems/${spec.kind}.mjs must export a default function`);
  const params = file === builtIn && BUILT_IN_EMBLEMS[spec.kind] ? check(BUILT_IN_EMBLEMS[spec.kind], spec, where) : spec;
  let fc;
  try { fc = plugin(params, { turf, families }); } catch (err) { fail(where, err.message); }
  if (fc?.type !== 'FeatureCollection') fail(where, `emblem plugin "${spec.kind}" must return a FeatureCollection`);
  // one translated name per id, kept beside the geometry, since map features hold plain values only
  const names = {};
  for (const f of fc.features) {
    const p = f.properties ??= {};
    if (p.family && !families[p.family]) fail(where, `emblem feature uses unknown family "${p.family}"`);
    if (p.name == null) continue;
    if (p.id == null) fail(where, `emblem feature named "${typeof p.name === 'string' ? p.name : Object.values(p.name)[0]}" needs an id`);
    names[p.id] ??= T(p.name, `emblems.${pid}.${p.id}`);
    delete p.name;
  }
  return { fc, names };
}

// Zones as drawn into the shapes the map shows: trimmed, rounded, clipped to land, checked for overlaps between
// families that share a page. Returns { id: Feature } and the lines it logged.
function cleanZones({ ordered, prio, together, smoothing, where, log }) {
  const shapes = coverage({ zones: ordered, prio, together, smoothing, fail, where, intersect, difference });
  const lines = [], say = l => { lines.push(l); log(l); };
  const box = Object.fromEntries(ordered.map(z => [z.id, turf.bbox(shapes[z.id])]));
  for (const z of ordered) {
    for (const h of ordered) {
      if (h.family === z.family || h.id <= z.id || !together(z.id, h.id) || !boxesMeet(box[z.id], box[h.id])) continue;
      const o = intersect(shapes[z.id], shapes[h.id]);
      if (o && km2(o) > 1) fail(where, `zones "${z.id}" and "${h.id}" overlap by ${km2(o).toFixed(1)} km2`);
    }
    // pieces under 1 km2 are clip noise and go; small islands remain and are listed so a sliver stands out
    if (shapes[z.id].geometry.type === 'MultiPolygon') {
      const kept = shapes[z.id].geometry.coordinates.filter(c => km2(turf.polygon(c)) >= 1);
      shapes[z.id] = kept.length === 1 ? turf.polygon(kept[0]) : turf.multiPolygon(kept);
      const small = kept.map(c => km2(turf.polygon(c))).filter(a => a < 50).map(a => a.toFixed(0));
      if (small.length) say(`  zone ${z.id}: small pieces of ${small.join(', ')} km2, islands or slivers`);
    }
    say(`  zone ${z.id}: ${Math.round(km2(shapes[z.id])).toLocaleString('en')} km2`);
  }
  return { shapes, lines };
}

// The story's content as text: story.yaml, the page tree, every page with its texts and emblem, and the zones, routes,
// markers, battles and images that shared/ and the pages define. It reads files only, no geometry and nothing in
// dist/. With onProblem, each problem goes to it as (folder, message) and the reading carries on, else the first throws.
function readContent(p, storyDir, onProblem = null) {
  const { rel, readYaml, readJson, log, root } = p;
  const where = rel(storyDir), shared = path.join(storyDir, 'shared');
  const attempt = (dir, fn) => { if (!onProblem) return fn(); try { return fn(); } catch (err) { onProblem(dir, err.message); } };
  const story = readYaml(path.join(storyDir, 'story.yaml'), Story);
  if (story.hillshade) log(`  ${where}/story.yaml: the relief comes from elevation tiles now, remove the hillshade line and geo/${story.hillshade}`);
  const langs = story.languages;
  const defaultLang = story.default_language ?? langs[0];
  // strings: the default language inline, the others from i18n/<lang>.yaml catalogues
  const { tr: T, entries, report } = translator({ langs, defaultLang, catalogues: loadCatalogues(path.join(storyDir, 'i18n'), langs, p.loadYaml), where: `${where}/i18n`, fail });

  // --- pages/ is a tree: a folder with page.yaml is a page, any other folder is a header for what it holds ---
  const walk = dir => listDirs(dir).map(name => {
    const full = path.join(dir, name), id = idOf(name);
    if (exists(path.join(full, 'page.yaml'))) return { type: 'page', id, dir: full };
    const g = exists(path.join(full, 'group.yaml')) ? attempt(full, () => readYaml(path.join(full, 'group.yaml'), Group)) ?? {} : {};
    return { type: 'group', id, title: T(g.title ?? id, `groups.${id}.title`), children: walk(full) };
  });
  const tree = walk(path.join(storyDir, 'pages'));
  const pagesIn = nodes => nodes.flatMap(n => n.type === 'page' ? [n.dir] : pagesIn(n.children));
  const pageDirs = pagesIn(tree);
  if (!pageDirs.length) fail(where, 'no pages');

  // --- zones, routes, markers, battles, images from shared/ and every page ---
  const zones = {}, routes = {}, markers = {}, battles = {}, images = {}, imageFiles = {}, definedIn = {};
  const define = (table, id, value, file, kind, dir) => { if (table[id]) fail(file, `${kind} "${id}" is defined twice`); table[id] = value; definedIn[`${kind} ${id}`] = dir; };
  const icons = {}, icon = (name, at) => icons[name] ??= iconSvg(name, at);
  for (const n of ['swords', 'x', 'external-link', 'chevron-left', 'chevron-right', 'list', 'info', 'settings']) icon(n, where);
  for (const dir of [shared, ...pageDirs]) {
    for (const f of listFiles(path.join(dir, 'zones'), '.geojson')) attempt(dir, () => {
      const file = path.join(dir, 'zones', f), feat = readJson(file, Zone), id = feat.properties.id ?? idOf(f.replace('.geojson', ''));
      if (!story.families[feat.properties.family]) fail(rel(file), `unknown family "${feat.properties.family}"`);
      for (const n of feat.properties.clip ?? []) if (!story.countries.includes(n)) fail(rel(file), `clip country "${n}" is not in the story's countries`);
      define(zones, id, { id, family: feat.properties.family, name: T(feat.properties.name, `zones.${id}.name`), geometry: feat.geometry, clipNames: feat.properties.clip ?? null }, rel(file), 'zone', dir);
    });
    for (const f of listFiles(path.join(dir, 'routes'), '.geojson')) attempt(dir, () => {
      const file = path.join(dir, 'routes', f), feat = readJson(file, Route), id = feat.properties.id ?? idOf(f.replace('.geojson', ''));
      define(routes, id, { id, name: T(feat.properties.name, `routes.${id}.name`), style: feat.properties.style, arrows: feat.properties.arrows, offset: feat.properties.offset, coordinates: feat.geometry.coordinates }, rel(file), 'route', dir);
    });
    const markerFile = path.join(dir, 'markers.yaml');
    if (exists(markerFile)) attempt(dir, () => {
      for (const [id, m] of Object.entries(readYaml(markerFile, Markers))) attempt(dir, () => {
        if (m.color && !story.families[m.color]) fail(rel(markerFile), `marker "${id}" uses unknown family "${m.color}"`);
        const name = LEGACY_ICONS[m.icon] ?? m.icon;
        icon(name, `${rel(markerFile)} marker "${id}"`);
        define(markers, id, { id, lnglat: m.lnglat, icon: name, color: m.color ?? null, image: m.image ?? null,
          label: T(m.label, `markers.${id}.label`, { shared: true }), note: m.note ? T(m.note, `markers.${id}.note`) : emptyText(langs) }, rel(markerFile), 'marker', dir);
      });
    });
    const battleFile = path.join(dir, 'battles.yaml');
    if (exists(battleFile)) attempt(dir, () => {
      for (const [id, b] of Object.entries(readYaml(battleFile, Battles))) attempt(dir, () => {
        const at = `${rel(battleFile)} ${id}`;
        const sides = b.sides.map((s, i) => {
          if (s.color && !/^#/.test(s.color) && !story.families[s.color]) fail(at, `side ${i + 1} uses unknown family "${s.color}"`);
          const k = `battles.${id}.sides.${i}`;
          return { name: T(s.name, `${k}.name`), color: s.color ?? null, commanders: s.commanders.map((c, j) => T(c, `${k}.commanders.${j}`, { shared: true })),
            strength: s.strength ? T(s.strength, `${k}.strength`) : null, casualties: s.casualties ? T(s.casualties, `${k}.casualties`) : null };
        });
        define(battles, id, { id, lnglat: b.lnglat, name: T(b.name, `battles.${id}.name`), date: T(b.date, `battles.${id}.date`), result: b.result ? T(b.result, `battles.${id}.result`) : null,
          sides, images: b.images, source: b.source ?? null, front: b.front ?? null }, rel(battleFile), 'battle', dir);
      });
    });
    const imageFile = exists(path.join(dir, 'page.yaml')) ? path.join(dir, 'page.yaml') : path.join(dir, 'images.yaml');
    if (exists(imageFile)) attempt(dir, () => {
      const imageMeta = imageFile.endsWith('page.yaml') ? readYaml(imageFile, Page).images : readYaml(imageFile, Images);
      for (const [id, im] of Object.entries(imageMeta)) attempt(dir, () => {
        const src = path.join(dir, 'images', im.file);
        if (!exists(src)) fail(rel(imageFile), `image "${id}" file ${im.file} is missing`);
        define(images, id, { id, src: 'images/' + id + path.extname(im.file), caption: T(im.caption, `images.${id}.caption`), credit: im.credit ? T(im.credit, `images.${id}.credit`, { shared: true }) : emptyText(langs) }, rel(imageFile), 'image', dir);
        imageFiles[id] = src;
      });
    });
  }
  for (const m of Object.values(markers)) if (m.image) attempt(definedIn[`marker ${m.id}`], () => images[m.image] || fail(where, `marker "${m.id}" uses unknown image "${m.image}"`));
  for (const b of Object.values(battles)) for (const im of b.images) attempt(definedIn[`battle ${b.id}`], () => images[im] || fail(where, `battle "${b.id}" uses unknown image "${im}"`));

  // --- pages ---
  const figure = (id, lang) => {
    const im = images[id];
    return `<figure><img src="${esc(im.src)}" alt="${esc(im.caption[lang])}" data-img="${esc(id)}"><figcaption>${esc(im.caption[lang])}<small>${esc(im.credit[lang])}</small></figcaption></figure>`;
  };
  // per page and language: the Markdown source, and the first image the text shows, for the static pages
  const texts = {}, firstImages = {};
  const readPage = dir => {
    const file = path.join(dir, 'page.yaml'), at = rel(file), pid = idOf(path.basename(dir));
    const pg = readYaml(file, Page);
    texts[pid] = {}; firstImages[pid] = {};
    const need = (ok, msg) => attempt(dir, () => ok || fail(at, msg));
    for (const z of pg.zones) need(zones[z], `unknown zone "${z}"`);
    for (const r of pg.routes) need(routes[r], `unknown route "${r}"`);
    for (const m of pg.markers) need(markers[m], `unknown marker "${m}"`);
    if (pg.battle) need(battles[pg.battle], `unknown battle "${pg.battle}"`);
    const w = pg.when == null ? null : typeof pg.when === 'string' ? { from: pg.when } : pg.when;
    const when = w && { from: whenEdge(w.from, false), to: whenEdge(w.to ?? w.from, true) };
    if (when) need(when.to >= when.from, 'when.to is before when.from');
    const html = {};
    for (const lang of langs) attempt(dir, () => {
      const text = path.join(dir, 'text', lang + '.md');
      if (!exists(text)) fail(rel(dir), `text/${lang}.md is missing`);
      texts[pid][lang] = fs.readFileSync(text, 'utf8');
      const md = texts[pid][lang].replace(/^@image\s+(\S+)\s*$/gm, (_, imgId) => {
        if (!images[imgId]) fail(rel(text), `unknown image "${imgId}"`);
        firstImages[pid][lang] ??= imgId;
        return `\n${figure(imgId, lang)}\n`;
      });
      html[lang] = marked.parse(md);
    });
    // a battle page opens in 3D when its view is close enough for the relief to show
    const camera = pg.camera === false ? null : pg.camera ?? (pg.battle && openZoom(pg.bbox) >= 6 ? Camera.parse({}) : null);
    const sourceTexts = pg.sources.map((s, i) => T(s, `pages.${pid}.sources.${i}`, { shared: true }));
    const sources = Object.fromEntries(langs.map(l => [l, sourceTexts.map(s => s[l])]));
    const emblem = pg.emblem ? attempt(dir, () => emblemFor(root, pg.emblem, `${at} emblem`, { families: story.families, T, pid })) : null;
    return { id: pid, dir: rel(dir), when, date: T(pg.date, `pages.${pid}.date`), title: T(pg.title, `pages.${pid}.title`),
      bbox: pg.bbox, camera, zones: pg.zones, routes: pg.routes, markers: pg.markers, battle: pg.battle ?? null, html, sources,
      emblem: emblem?.fc ?? null, emblemNames: emblem?.names ?? {} };
  };
  const pages = pageDirs.map(dir => attempt(dir, () => readPage(dir))).filter(Boolean);
  for (let i = 1; i < pages.length; i++) attempt(path.join(root, pages[i].dir), () => {
    if (pages.find((q, j) => j < i && q.id === pages[i].id)) fail(where, `two pages share the id "${pages[i].id}"`);
    const prev = pages.slice(0, i).reverse().find(q => q.when);
    if (prev && pages[i].when && pages[i].when.from < prev.when.from) fail(where, `${pages[i].dir} starts ${pages[i].when.from}, before ${prev.dir} which starts ${prev.when.from}; fix the folder numbers or the when fields`);
  });
  return { story, langs, defaultLang, T, entries, translations: report, tree, zones, routes, markers, battles, images, imageFiles, icons, pages, texts, firstImages };
}

function buildStory(p, storyDir, site) {
  const { log, root } = p;
  const where = p.rel(storyDir);
  const { story, langs, defaultLang, T, entries, translations, tree, zones: rawZones, routes, markers, battles, images, imageFiles, icons, pages, texts, firstImages } = readContent(p, storyDir);
  const ui = uiFor(langs, root);
  const { tr: siteT } = translator({ langs, defaultLang: site.default_language ?? defaultLang, catalogues: loadCatalogues(path.join(root, 'i18n'), langs, p.loadYaml), where: 'i18n', fail });
  if (story.theme && !site.themes[story.theme]) fail(where, `unknown theme "${story.theme}"`);
  // the story is written to a fresh folder and swapped in once it built, so a failed build keeps the last good one
  // and a page that went leaves no file behind
  const final = path.join(p.dist, story.id), out = path.join(p.dist, `.${story.id}.next`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'images'), { recursive: true });
  for (const [id, file] of Object.entries(imageFiles)) fs.copyFileSync(file, path.join(out, images[id].src));

  // --- borders and land ---
  // borders are cut to the extent plus a margin, so a country with a long coastline elsewhere stays out of the bundle
  const [ew, es, ee, en] = story.extent, margin = 5;
  const clipBox = [Math.max(-180, ew - margin), Math.max(-90, es - margin), Math.min(180, ee + margin), Math.min(90, en + margin)];
  // bboxClip leaves an empty polygon for every piece outside the box, which the geometry library refuses
  const clip = f => { const g = turf.bboxClip(f, clipBox).geometry, polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).filter(p => p.length && p[0].length >= 4); return polys.length === 1 ? turf.polygon(polys[0]).geometry : turf.multiPolygon(polys).geometry; };
  const countries = world().filter(f => story.countries.includes(f.properties.name))
    .map(f => ({ type: 'Feature', id: f.id, properties: { name: f.properties.name }, geometry: clip(f) }));
  for (const n of story.countries) if (!countries.find(f => f.properties.name === n)) fail(where, `country "${n}" not in Natural Earth`);
  for (const f of countries) if (!f.geometry.coordinates.length) fail(where, `country "${f.properties.name}" lies outside the extent`);
  const landParts = story.land.map(n => countries.find(f => f.properties.name === n) || fail(where, `land "${n}" is not in countries`));
  const land = landParts.length > 1 ? turf.union(turf.featureCollection(landParts)) : landParts[0];
  const topo = ts.topology({ countries: { type: 'FeatureCollection', features: countries } }, 1e5);
  // tint: an index into the theme's land tints such that no two neighbours share one; most connected countries first
  const geoms = topo.objects.countries.geometries, near = tc.neighbors(geoms);
  for (const i of geoms.map((_, i) => i).sort((a, b) => near[b].length - near[a].length)) {
    const taken = new Set(near[i].map(j => geoms[j].properties.tint));
    let t = 0; while (taken.has(t)) t++;
    geoms[i].properties.tint = t % LAND_SLOTS;
  }

  // --- country labels: one point per country at the pole of inaccessibility of its largest visible piece ---
  // The text per language is the override from story.yaml, else the Natural Earth name. rank orders collisions, big first.
  let labels = null;
  if (story.labels?.countries) {
    for (const n of [...Object.keys(story.labels.names), ...story.labels.hide]) if (!story.countries.includes(n)) fail(where, `labels name "${n}" is not in countries`);
    labels = countries.filter(f => !story.labels.hide.includes(f.properties.name)).map(f => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const biggest = polys.map(c => turf.polygon(c)).sort((a, b) => turf.area(b) - turf.area(a))[0];
      const [x, y] = polylabel(biggest.geometry.coordinates, 0.01);
      const text = story.labels.names[f.properties.name] ? T(story.labels.names[f.properties.name], `labels.${f.properties.name}`) : Object.fromEntries(langs.map(l => [l, f.properties.name]));
      return { type: 'Feature', properties: { ...text, rank: -Math.round(km2(f)) }, geometry: { type: 'Point', coordinates: [+x.toFixed(3), +y.toFixed(3)] } };
    });
  }

  // each zone is clipped to the land, or to the countries its clip names
  for (const z of Object.values(rawZones)) {
    const parts = (z.clipNames ?? []).map(n => countries.find(f => f.properties.name === n));
    z.clip = !parts.length ? land : parts.length > 1 ? turf.union(turf.featureCollection(parts)) : parts[0];
  }

  // --- clean zones: trim by family priority, round the shared boundaries once, clip to land, validate ---
  // zones only trim and overlap check against zones that share a page with them, so a 1915 beachhead
  // never cuts a hole in a 1919 occupation zone
  const pageZones = pages.map(pg => pg.zones);
  const pairs = new Set(pageZones.flatMap(zs => zs.flatMap(a => zs.map(b => a + ' ' + b))));
  const together = (a, b) => pairs.has(a + ' ' + b);
  const prio = f => story.families[f].priority;
  const ordered = Object.values(rawZones).sort((a, b) => prio(a.family) - prio(b.family));
  // the cleaned shapes follow from these inputs alone, so a build that leaves them as they were reads the cache
  const zoneKey = hash({ code: GEOMETRY_CODE, extent: story.extent, land: story.land, smoothing: story.smoothing, pages: pageZones,
    prio: Object.fromEntries(Object.keys(story.families).map(f => [f, prio(f)])), zones: ordered.map(z => [z.id, z.family, z.clipNames, z.geometry]) });
  const zoneFile = path.join(p.cache, 'stories', path.basename(storyDir), 'zones.json');
  const cached = readCache(zoneFile);
  let shapes, zoneLines;
  if (cached?.key === zoneKey) {
    ({ shapes, lines: zoneLines } = cached);
    for (const l of zoneLines) log(l);
  } else {
    ({ shapes, lines: zoneLines } = cleanZones({ ordered, prio, together, smoothing: story.smoothing, where, log }));
    writeCache(zoneFile, { key: zoneKey, shapes, lines: zoneLines });
  }
  const zones = Object.fromEntries(ordered.map(z => [z.id, { ...z, feature: shapes[z.id] }]));

  // --- families shown on the same page must differ in colour or in pattern ---
  for (const f of alikePairs(story.families, pages.map(p => ({ dir: p.dir, families: [...new Set(p.zones.map(z => zones[z].family))] })))) log(`  warning: ${describe(f)}`);
  const pageIndex = Object.fromEntries(pages.map((p, i) => [p.id, i]));
  const navTree = nodes => nodes.map(n => n.type === 'page' ? { type: 'page', index: pageIndex[n.id] } : { type: 'group', id: n.id, title: n.title, children: navTree(n.children) });

  // --- cover image for the site index ---
  let cover = null;
  if (story.cover) {
    const src = path.join(storyDir, story.cover);
    if (!exists(src)) fail(where, `cover ${story.cover} is missing`);
    cover = 'cover' + path.extname(story.cover); fs.copyFileSync(src, path.join(out, cover));
  }

  // --- elevation: the tiles this story needs; build() cuts them into dist/terrain, shared by every story ---
  const terrain = { tiles: '../terrain/{z}/{x}/{y}.png', ...terrainPlan(story.extent, pages.map(pg => pg.bbox), story.max_zoom) };

  // span is story.span, else the years from the pages' when fields, else the first page's date
  const dated = pages.filter(p => p.when);
  const years = dated.length ? [...new Set([dated[0].when.from.slice(0, 4), dated[dated.length - 1].when.to.slice(0, 4)])].join(' – ') : null;
  const span = story.span ? T(story.span, 'story.span') : Object.fromEntries(langs.map(l => [l, years ?? pages[0].date[l]]));
  const summary = story.summary ? T(story.summary, 'story.summary') : {};

  // --- bundle and pages ---
  const bundle = {
    id: story.id, title: T(story.title, 'story.title'), summary, span, cover, languages: langs, defaultLanguage: defaultLang,
    extent: story.extent, maxZoom: story.max_zoom, ui, families: story.families,
    site: { title: siteT(site.title, 'site.title'), languages: site.langs, defaultLanguage: site.defaultLang,
      source: site.repository ? `${site.repository.replace(/\/$/, '')}/tree/${site.branch}/content/${story.id}` : null },
    themes: themeList(site.themes, ui, langs), defaultTheme: story.theme ?? site.theme,
    topo, land: { type: 'Feature', properties: {}, geometry: land.geometry }, terrain, labels,
    zones: Object.fromEntries(Object.values(zones).map(z => [z.id, { family: z.family, name: z.name, area: Math.round(km2(z.feature)), geometry: turf.truncate(z.feature, { precision: 4 }).geometry }])),
    routes, markers, battles, images, icons, pages: pages.map(({ dir, ...p }) => p), tree: navTree(tree),
  };
  const familyCss = Object.entries(story.families).map(([f, c]) => `--z-${f}:${c.color};`).join('');
  const familyCssDark = Object.entries(story.families).map(([f, c]) => `--z-${f}:${c.color_dark ?? c.color};`).join('');
  const shell = APP.replace('/*__FAMILY_CSS__*/', () => familyCss).replaceAll('/*__FAMILY_CSS_DARK__*/', () => familyCssDark)
    .replace('/*__THEMES_CSS__*/', () => themeCss(site.themes, bundle.defaultTheme));
  const storyJs = `const BUNDLE = ${JSON.stringify(bundle)};\n`;
  writeFile(path.join(out, 'story.js'), storyJs);
  const files = storyFiles({ shell, bundle, texts, firstImages, site: site.context, versions: { story: version(storyJs), app: version(APP_JS) } });
  for (const [f, text] of Object.entries(files)) writeFile(path.join(out, f), text);
  log(`  wrote dist/${story.id}/ (story.js ${(Buffer.byteLength(storyJs) / 1e6).toFixed(1)} MB, ${pages.length} pages in ${langs.join('/')})`);

  // translation coverage per language; --strict turns a gap into an error
  for (const [lang, r] of Object.entries(translations())) {
    log(`  ${lang}: ${r.total - r.missing.length} of ${r.total} strings translated${r.missing.length ? `, ${r.missing.length} missing (harita i18n ${lang})` : ''}`);
    if (p.strict && r.missing.length) fail(where, `${lang}: ${r.missing.length} strings missing, first: ${r.missing.slice(0, 8).join(', ')}`);
  }
  for (const lang of langs.filter(l => l !== 'en')) {
    const u = uiCatalogue(root, lang, site.themes);
    if (u.missing.length) log(`  ${lang} interface: ${u.entries.length - u.missing.length} of ${u.entries.length} strings translated, ${u.missing.length} missing (harita i18n ${lang})`);
    if (p.strict && u.missing.length) fail(where, `${lang} interface: ${u.missing.length} strings missing, first: ${u.missing.slice(0, 8).join(', ')}`);
  }
  fs.rmSync(final, { recursive: true, force: true });
  fs.renameSync(out, final);
  return { format: CARD_FORMAT, id: story.id, title: bundle.title, summary, span, languages: langs, defaultLanguage: defaultLang, pages: pages.length, cover, i18n: [...entries.values()], terrain };
}

// The site index. site.yaml is optional: the folder name, alphabetical order and the cool theme stand in.
function buildIndex(p, cards, site) {
  const langs = site.langs, defaultLang = site.defaultLang;
  const order = site.stories ?? cards.map(c => c.id);
  for (const id of order) if (!cards.find(c => c.id === id)) fail('site.yaml', `unknown story "${id}"`);
  const { tr: T, entries, report } = translator({ langs, defaultLang, catalogues: loadCatalogues(path.join(p.root, 'i18n'), langs, p.loadYaml), where: 'i18n', fail });
  const ui = uiFor(langs, p.root);
  const data = {
    title: T(site.title, 'site.title'), intro: site.intro ? T(site.intro, 'site.intro') : {},
    languages: langs, defaultLanguage: defaultLang, ui, repository: site.repository ?? null, icons: { settings: iconSvg('settings', 'site.yaml') },
    stories: order.map(id => { const { i18n, terrain, ...card } = cards.find(c => c.id === id); return card; }),
    themes: themeList(site.themes, ui, langs), defaultTheme: site.theme,
  };
  for (const [lang, r] of Object.entries(report())) {
    if (r.missing.length) p.log(`site ${lang}: ${r.missing.length} of ${r.total} strings missing (harita i18n ${lang})`);
    if (p.strict && r.missing.length) fail('site.yaml', `${lang}: missing ${r.missing.join(', ')}`);
  }
  p.siteEntries = [...entries.values()];
  const css = themeCss(site.themes, site.theme);
  // the 404 page speaks every language a site or story page does
  const notFoundUi = uiFor([...new Set([...langs, ...cards.flatMap(c => c.languages)])], p.root);
  const files = siteFiles({ shell: INDEX.replace('/*__THEMES_CSS__*/', () => css), data, site: site.context, common: COMMON, themeCss: css, ui: notFoundUi });
  for (const [f, text] of Object.entries(files)) writeFile(path.join(p.dist, f), text);
  p.log(`wrote dist/index.html (${data.stories.length} stories)`);
}

// Every problem in one story's content, without the geometry: the pages, their texts and emblems, and the files
// they use. pages limits the check to those page ids and shared/. Returns the problems, [] when there are none.
export function checkStory({ root = process.cwd(), story, pages = [], log = console.log } = {}) {
  const p = project(root, log);
  const stories = listDirs(p.content).filter(d => exists(path.join(p.content, d, 'story.yaml')));
  if (!stories.includes(story)) fail('content/', `"${story}" is not a story folder, the stories are ${stories.join(', ')}`);
  const storyDir = path.join(p.content, story), shared = path.join(storyDir, 'shared');
  const inScope = dir => !pages.length || dir === shared || pages.includes(idOf(path.basename(dir)));
  const problems = [];
  try {
    const { tree } = readContent(p, storyDir, (dir, msg) => { if (inScope(dir)) problems.push(msg); });
    const ids = new Set(), collect = nodes => { for (const n of nodes) n.type === 'page' ? ids.add(n.id) : collect(n.children); };
    collect(tree);
    for (const id of pages) if (!ids.has(id)) problems.push(`content/${story}/pages: no page "${id}"`);
  } catch (err) { problems.push(err.message); } // story.yaml itself or an empty pages/ stops the reading
  return problems;
}

// Every story under root/content into root/dist, without the elevation tiles. harita i18n reads its strings.
// only names story folders to build; the others keep their last build, and their main page cards come from the cache.
// story builds that one story folder into a site of its own, its main page listing it alone. out replaces dist/.
export function buildPages({ root = process.cwd(), log = console.log, strict = false, cache = path.join(root, '.cache', 'harita'), only = null, story = null, out = null } = {}) {
  const p = project(root, log);
  p.strict = strict; p.cache = cache;
  if (out) p.dist = path.resolve(root, out);
  const stories = listDirs(p.content).filter(d => exists(path.join(p.content, d, 'story.yaml')));
  if (!stories.length) fail('content/', 'no story.yaml found, run this from a content project');
  for (const s of [...(only ?? []), ...(story ? [story] : [])]) if (!stories.includes(s)) fail('content/', `"${s}" is not a story folder, the stories are ${stories.join(', ')}`);
  const cardFile = s => path.join(cache, 'stories', s, 'card.json');
  // a card from the last build, while that build's page is still in dist/
  const lastCard = s => { const c = readCache(cardFile(s)); return c?.format === CARD_FORMAT && exists(path.join(p.dist, c.id, 'index.html')) ? c : null; };
  const siteFile = path.join(root, 'site.yaml');
  const siteMeta = exists(siteFile) ? p.readYaml(siteFile, Site) : {};
  const builtIn = check(Themes, p.loadYaml(path.join(PKG, 'src', 'themes.yaml')), 'src/themes.yaml');
  const site = { ...siteMeta, title: siteMeta.title ?? path.basename(root), theme: siteMeta.theme ?? 'cool', themes: { ...builtIn, ...(siteMeta.themes ?? {}) } };
  if (!site.themes[site.theme]) fail('site.yaml', `unknown theme "${site.theme}"`);
  // story ids and language codes both name folders at the top of dist/
  // building one story, another story's story.yaml that does not read yet is left out of the checks
  const meta = s => [s, p.readYaml(path.join(p.content, s, 'story.yaml'), Story)];
  const metas = stories.flatMap(s => { if (!story || s === story) return [meta(s)]; try { return [meta(s)]; } catch { return []; } });
  site.langs = site.languages ?? [...new Set(metas.flatMap(([, m]) => m.languages))];
  site.defaultLang = site.default_language ?? site.langs[0];
  const codes = new Set([...site.langs, ...metas.flatMap(([, m]) => m.languages)]);
  for (const [s, m] of metas) if (codes.has(m.id)) fail(`content/${s}/story.yaml`, `the story id "${m.id}" is also a language code, and both would be the folder dist/${m.id}/, so give the story another id`);
  site.context = siteContext({ url: site.url, languages: site.langs, defaultLanguage: site.defaultLang });
  if (story) site.stories = [metas.find(([s]) => s === story)[1].id];
  writeFile(path.join(p.dist, 'harita.js'), APP_JS);
  const cards = [];
  for (const s of story ? [story] : stories) {
    const kept = only && !only.includes(s) && lastCard(s);
    if (kept) { cards.push(kept); continue; }
    log(`story ${s}`);
    const card = buildStory(p, path.join(p.content, s), site);
    const { i18n, terrain, ...saved } = card;
    writeCache(cardFile(s), saved);
    cards.push(card);
  }
  buildIndex(p, cards, site);
  const built = cards.filter(c => c.terrain);
  return { dist: p.dist, themes: site.themes, stories: cards.map(({ i18n, terrain, ...card }) => card), i18n: { stories: Object.fromEntries(built.map(c => [c.id, c.i18n])), site: p.siteEntries },
    terrain: tileKeys(built.map(c => c.terrain)) };
}

// Build every story under root/content into root/dist, with the elevation tiles. Returns the dist folder and one
// card per story. Tiles and each story's cleaned zones are kept in cache, so only the first build of an area
// downloads tiles, and a build that leaves a story's zones as they were skips their geometry.
export async function build({ root = process.cwd(), log = console.log, strict = false, cache = path.join(root, '.cache', 'harita'), elevation, only = null, story = null, out = null } = {}) {
  const { terrain, ...r } = buildPages({ root, log, strict, cache, only, story, out });
  await terrainTiles({ keys: terrain, cache, out: path.join(r.dist, 'terrain'), elevation, log });
  return r;
}
