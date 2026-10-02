// Walk content/<story>/, clean the geometry, render the texts, and write dist/.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import yaml from 'js-yaml';
import { marked } from 'marked';
import * as turf from '@turf/turf';
import * as tc from 'topojson-client';
import * as ts from 'topojson-server';
import polylabel from 'polylabel';
import { check, Site, Story, Group, Page, Markers, Battles, Images, Zone, Route, Themes } from './schema.mjs';
import { alikePairs, describe } from './palette.mjs';
import { loadCatalogues, translator } from './i18n.mjs';

// PKG is this package. The content project comes in as the root of each build.
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const REPO = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
const COMMON = fs.readFileSync(path.join(PKG, 'src', 'common.js'), 'utf8').replace('/*__REPO__*/', REPO);
const APP = fs.readFileSync(path.join(PKG, 'src', 'app.html'), 'utf8').replace('/*__COMMON__*/', COMMON);
const INDEX = fs.readFileSync(path.join(PKG, 'src', 'index.html'), 'utf8').replace('/*__COMMON__*/', COMMON);
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
const difference = (a, b) => turf.difference(turf.featureCollection([a, b]));
const idOf = name => name.replace(/^\d+-/, '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const emptyText = langs => Object.fromEntries(langs.map(l => [l, '']));
// A when value with the missing parts rounded down for from and up for to.
const whenEdge = (s, isEnd) => { const [y, m, d] = s.split('-'); return `${y}-${m ?? (isEnd ? '12' : '01')}-${d ?? (isEnd ? '31' : '01')}`; };
// Interface strings for a language: the package file, else English, with the project's i18n/ui/<lang>.yaml laid over it.
function uiFor(langs, root, log) {
  return Object.fromEntries(langs.map(l => {
    const override = path.join(root, 'i18n', 'ui', l + '.yaml');
    if (!UI[l] && !exists(override)) log(`  warning: no interface strings for "${l}", showing English; add i18n/ui/${l}.yaml`);
    return [l, { ...(UI[l] ?? UI.en), ...(exists(override) ? yaml.load(fs.readFileSync(override, 'utf8')) : {}) }];
  }));
}
const themeList = (themes, ui, langs) => Object.entries(themes).map(([id, t]) => ({ id, name: Object.fromEntries(langs.map(l => [l, ui[l].themes?.[id] ?? t.name?.[l] ?? t.name?.en ?? id])) }));

// The content project of one build: its folders, its logger, and readers that name files relative to it.
function project(root, log) {
  const rel = p => path.relative(root, p);
  const loadYaml = p => { try { return yaml.load(fs.readFileSync(p, 'utf8')) ?? {}; } catch (e) { fail(rel(p), e.message); } };
  const readYaml = (p, schema) => check(schema, loadYaml(p), rel(p));
  const readJson = (p, schema) => check(schema, JSON.parse(fs.readFileSync(p, 'utf8')), rel(p));
  return { root, content: path.join(root, 'content'), geo: path.join(root, 'geo'), dist: path.join(root, 'dist'), log, rel, loadYaml, readYaml, readJson };
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

// Emblem plugins live in the content project: plugins/emblems/<kind>.mjs exports a function
// (params, { turf }) => GeoJSON FeatureCollection, drawn as a fill layer with each feature's "color".
// Node 22.12+ loads an ES module through require synchronously, which keeps the build synchronous.
function emblemFor(root, spec, where) {
  const file = path.join(root, 'plugins', 'emblems', spec.kind + '.mjs');
  if (!exists(file)) fail(where, `unknown emblem kind "${spec.kind}", add plugins/emblems/${spec.kind}.mjs`);
  const plugin = require(file).default;
  if (typeof plugin !== 'function') fail(where, `plugins/emblems/${spec.kind}.mjs must export a default function`);
  const fc = plugin(spec, { turf });
  if (fc?.type !== 'FeatureCollection') fail(where, `emblem plugin "${spec.kind}" must return a FeatureCollection`);
  return fc;
}

function buildStory(p, storyDir, site) {
  const { rel, readYaml, readJson, log, root } = p;
  const where = rel(storyDir);
  const story = readYaml(path.join(storyDir, 'story.yaml'), Story);
  const langs = story.languages;
  const defaultLang = story.default_language ?? langs[0];
  const ui = uiFor(langs, root, log);
  // strings: the default language inline, the others from i18n/<lang>.yaml catalogues
  const { tr: T, entries, report } = translator({ langs, defaultLang, catalogues: loadCatalogues(path.join(storyDir, 'i18n'), langs, p.loadYaml), where: `${where}/i18n`, fail });
  const { tr: siteT } = translator({ langs, defaultLang: site.default_language ?? defaultLang, catalogues: loadCatalogues(path.join(root, 'i18n'), langs, p.loadYaml), where: 'i18n', fail });
  if (story.theme && !site.themes[story.theme]) fail(where, `unknown theme "${story.theme}"`);
  const out = path.join(p.dist, story.id);
  fs.mkdirSync(path.join(out, 'images'), { recursive: true });

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
  // tint: an index into the theme's land tints such that no two neighbours share one; most connected countries first
  const touches = countries.map(a => countries.filter(b => b !== a && turf.booleanIntersects(a, b)));
  for (const i of countries.map((_, i) => i).sort((a, b) => touches[b].length - touches[a].length)) {
    const taken = new Set(touches[i].map(n => n.properties.tint).filter(t => t != null));
    let t = 0; while (taken.has(t)) t++;
    countries[i].properties.tint = t % LAND_SLOTS;
  }
  const landParts = story.land.map(n => countries.find(f => f.properties.name === n) || fail(where, `land "${n}" is not in countries`));
  const land = landParts.length > 1 ? turf.union(turf.featureCollection(landParts)) : landParts[0];
  const topo = ts.topology({ countries: { type: 'FeatureCollection', features: countries } }, 1e5);

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

  // --- pages/ is a tree: a folder with page.yaml is a page, any other folder is a header for what it holds ---
  const walk = dir => listDirs(dir).map(name => {
    const full = path.join(dir, name), id = idOf(name);
    if (exists(path.join(full, 'page.yaml'))) return { type: 'page', id, dir: full };
    const g = exists(path.join(full, 'group.yaml')) ? readYaml(path.join(full, 'group.yaml'), Group) : {};
    return { type: 'group', id, title: T(g.title ?? id, `groups.${id}.title`), children: walk(full) };
  });
  const tree = walk(path.join(storyDir, 'pages'));
  const pageDirs = [];
  const flatten = nodes => nodes.forEach(n => n.type === 'page' ? pageDirs.push(n.dir) : flatten(n.children));
  flatten(tree);
  if (!pageDirs.length) fail(where, 'no pages');

  // --- zones, routes, markers, images from shared/ and every page ---
  const rawZones = {}, routes = {}, markers = {}, battles = {}, images = {};
  const define = (table, id, value, file, kind) => { if (table[id]) fail(file, `${kind} "${id}" is defined twice`); table[id] = value; };
  for (const dir of [path.join(storyDir, 'shared'), ...pageDirs]) {
    for (const f of listFiles(path.join(dir, 'zones'), '.geojson')) {
      const file = path.join(dir, 'zones', f), feat = readJson(file, Zone), id = feat.properties.id ?? idOf(f.replace('.geojson', ''));
      if (!story.families[feat.properties.family]) fail(rel(file), `unknown family "${feat.properties.family}"`);
      let clip = land;
      if (feat.properties.clip) {
        const parts = feat.properties.clip.map(n => countries.find(f => f.properties.name === n) || fail(rel(file), `clip country "${n}" is not in the story's countries`));
        clip = parts.length > 1 ? turf.union(turf.featureCollection(parts)) : parts[0];
      }
      define(rawZones, id, { id, family: feat.properties.family, name: T(feat.properties.name, `zones.${id}.name`), geometry: feat.geometry, clip }, rel(file), 'zone');
    }
    for (const f of listFiles(path.join(dir, 'routes'), '.geojson')) {
      const file = path.join(dir, 'routes', f), feat = readJson(file, Route), id = feat.properties.id ?? idOf(f.replace('.geojson', ''));
      define(routes, id, { id, name: T(feat.properties.name, `routes.${id}.name`), style: feat.properties.style, coordinates: feat.geometry.coordinates }, rel(file), 'route');
    }
    const markerFile = path.join(dir, 'markers.yaml');
    if (exists(markerFile)) {
      for (const [id, m] of Object.entries(readYaml(markerFile, Markers))) {
        if (m.color && !story.families[m.color]) fail(rel(markerFile), `marker "${id}" uses unknown family "${m.color}"`);
        define(markers, id, { id, lnglat: m.lnglat, icon: LEGACY_ICONS[m.icon] ?? m.icon, color: m.color ?? null, image: m.image ?? null,
          label: T(m.label, `markers.${id}.label`), note: m.note ? T(m.note, `markers.${id}.note`) : emptyText(langs) }, rel(markerFile), 'marker');
      }
    }
    const battleFile = path.join(dir, 'battles.yaml');
    if (exists(battleFile)) {
      for (const [id, b] of Object.entries(readYaml(battleFile, Battles))) {
        const at = `${rel(battleFile)} ${id}`;
        const sides = b.sides.map((s, i) => {
          if (s.color && !/^#/.test(s.color) && !story.families[s.color]) fail(at, `side ${i + 1} uses unknown family "${s.color}"`);
          const k = `battles.${id}.sides.${i}`;
          return { name: T(s.name, `${k}.name`), color: s.color ?? null, commanders: s.commanders.map((c, j) => T(c, `${k}.commanders.${j}`)),
            strength: s.strength ? T(s.strength, `${k}.strength`) : null, casualties: s.casualties ? T(s.casualties, `${k}.casualties`) : null };
        });
        define(battles, id, { id, lnglat: b.lnglat, name: T(b.name, `battles.${id}.name`), date: T(b.date, `battles.${id}.date`), result: b.result ? T(b.result, `battles.${id}.result`) : null,
          sides, images: b.images, source: b.source ?? null, front: b.front ?? null }, rel(battleFile), 'battle');
      }
    }
    const imageFile = exists(path.join(dir, 'page.yaml')) ? path.join(dir, 'page.yaml') : path.join(dir, 'images.yaml');
    const imageMeta = !exists(imageFile) ? {} : imageFile.endsWith('page.yaml') ? readYaml(imageFile, Page).images : readYaml(imageFile, Images);
    for (const [id, im] of Object.entries(imageMeta)) {
      const src = path.join(dir, 'images', im.file);
      if (!exists(src)) fail(rel(imageFile), `image "${id}" file ${im.file} is missing`);
      const name = id + path.extname(im.file);
      fs.copyFileSync(src, path.join(out, 'images', name));
      define(images, id, { id, src: 'images/' + name, caption: T(im.caption, `images.${id}.caption`), credit: im.credit ? T(im.credit, `images.${id}.credit`, { shared: true }) : emptyText(langs) }, rel(imageFile), 'image');
    }
  }
  for (const m of Object.values(markers)) if (m.image && !images[m.image]) fail(where, `marker "${m.id}" uses unknown image "${m.image}"`);
  for (const b of Object.values(battles)) for (const im of b.images) if (!images[im]) fail(where, `battle "${b.id}" uses unknown image "${im}"`);
  const iconNames = new Set(['swords', 'x', 'external-link', 'chevron-left', 'chevron-right', 'list', ...Object.values(markers).map(m => m.icon)]);
  const icons = Object.fromEntries([...iconNames].map(n => [n, iconSvg(n, where)]));

  // --- clean zones: round corners, clip to land, trim by family priority, validate ---
  // zones only trim and overlap check against zones that share a page with them, so a 1915 beachhead
  // never cuts a hole in a 1919 occupation zone
  const pageZones = pageDirs.map(dir => readYaml(path.join(dir, 'page.yaml'), Page).zones);
  const together = (a, b) => pageZones.some(zs => zs.includes(a) && zs.includes(b));
  const prio = f => story.families[f].priority;
  const zones = {};
  const ordered = Object.values(rawZones).sort((a, b) => prio(a.family) - prio(b.family));
  for (const z of ordered) {
    let g = turf.feature(z.geometry);
    if (story.smoothing) g = turf.polygonSmooth(g, { iterations: story.smoothing }).features[0];
    g = intersect(g, z.clip);
    if (!g) fail(where, `zone "${z.id}": nothing left after the land clip`);
    for (const h of ordered) {
      if (h.family === z.family || prio(h.family) >= prio(z.family) || !together(z.id, h.id)) continue;
      const cut = difference(g, zones[h.id].feature);
      if (!cut) fail(where, `zone "${z.id}": fully covered by "${h.id}"`);
      g = cut;
    }
    zones[z.id] = { ...z, feature: g };
  }
  for (const z of Object.values(zones)) {
    const onLand = intersect(z.feature, z.clip);
    const off = km2(z.feature) - (onLand ? km2(onLand) : 0);
    if (off > 1) fail(where, `zone "${z.id}": ${off.toFixed(1)} km2 outside the land`);
    for (const h of Object.values(zones)) {
      if (h.family === z.family || h.id <= z.id || !together(z.id, h.id)) continue;
      const o = intersect(z.feature, h.feature);
      if (o && km2(o) > 1) fail(where, `zones "${z.id}" and "${h.id}" overlap by ${km2(o).toFixed(1)} km2`);
    }
    // pieces under 1 km2 are clip noise and go; small islands remain and are listed so a sliver stands out
    if (z.feature.geometry.type === 'MultiPolygon') {
      const kept = z.feature.geometry.coordinates.filter(c => km2(turf.polygon(c)) >= 1);
      z.feature = kept.length === 1 ? turf.polygon(kept[0]) : turf.multiPolygon(kept);
      const small = kept.map(c => km2(turf.polygon(c))).filter(a => a < 50).map(a => a.toFixed(0));
      if (small.length) log(`  zone ${z.id}: small pieces of ${small.join(', ')} km2, islands or slivers`);
    }
    log(`  zone ${z.id}: ${Math.round(km2(z.feature)).toLocaleString('en')} km2`);
  }

  // --- pages ---
  const figure = (id, lang) => {
    const im = images[id];
    return `<figure><img src="${esc(im.src)}" alt="${esc(im.caption[lang])}" data-img="${esc(id)}"><figcaption>${esc(im.caption[lang])}<small>${esc(im.credit[lang])}</small></figcaption></figure>`;
  };
  const pages = pageDirs.map(dir => {
    const file = path.join(dir, 'page.yaml'), at = rel(file), pid = idOf(path.basename(dir));
    const p = readYaml(file, Page);
    for (const z of p.zones) if (!zones[z]) fail(at, `unknown zone "${z}"`);
    for (const r of p.routes) if (!routes[r]) fail(at, `unknown route "${r}"`);
    for (const m of p.markers) if (!markers[m]) fail(at, `unknown marker "${m}"`);
    if (p.battle && !battles[p.battle]) fail(at, `unknown battle "${p.battle}"`);
    const w = p.when == null ? null : typeof p.when === 'string' ? { from: p.when } : p.when;
    const when = w && { from: whenEdge(w.from, false), to: whenEdge(w.to ?? w.from, true) };
    if (when && when.to < when.from) fail(at, 'when.to is before when.from');
    const html = {};
    for (const lang of langs) {
      const text = path.join(dir, 'text', lang + '.md');
      if (!exists(text)) fail(rel(dir), `text/${lang}.md is missing`);
      const md = fs.readFileSync(text, 'utf8').replace(/^@image\s+(\S+)\s*$/gm, (_, imgId) => {
        if (!images[imgId]) fail(rel(text), `unknown image "${imgId}"`);
        return `\n${figure(imgId, lang)}\n`;
      });
      html[lang] = marked.parse(md);
    }
    const sourceTexts = p.sources.map((s, i) => T(s, `pages.${pid}.sources.${i}`, { shared: true }));
    const sources = Object.fromEntries(langs.map(l => [l, sourceTexts.map(s => s[l])]));
    return { id: pid, dir: rel(dir), when, date: T(p.date, `pages.${pid}.date`), title: T(p.title, `pages.${pid}.title`),
      bbox: p.bbox, zones: p.zones, routes: p.routes, markers: p.markers, battle: p.battle ?? null, emblem: p.emblem ? emblemFor(root, p.emblem, `${at} emblem`) : null, html, sources };
  });
  for (let i = 1; i < pages.length; i++) {
    if (pages.find((q, j) => j < i && q.id === pages[i].id)) fail(where, `two pages share the id "${pages[i].id}"`);
    const prev = pages.slice(0, i).reverse().find(q => q.when);
    if (prev && pages[i].when && pages[i].when.from < prev.when.from) fail(where, `${pages[i].dir} starts ${pages[i].when.from}, before ${prev.dir} which starts ${prev.when.from}; fix the folder numbers or the when fields`);
  }
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

  // --- hillshade ---
  const hillFile = path.join(p.geo, story.hillshade);
  if (!exists(hillFile)) fail(where, `hillshade geo/${story.hillshade} is missing`);
  const hillBbox = JSON.parse(fs.readFileSync(hillFile.replace(/\.png$/, '.bbox.json'), 'utf8'));
  // the raster ships as a file next to the page, so the browser caches it and the HTML stays small
  fs.copyFileSync(hillFile, path.join(out, 'hillshade.png'));
  const hill = { src: 'hillshade.png', bbox: hillBbox };

  // --- bundle and page ---
  const bundle = {
    id: story.id, title: T(story.title, 'story.title'), languages: langs, defaultLanguage: defaultLang,
    extent: story.extent, ui, families: story.families,
    site: { title: siteT(site.title, 'site.title'), source: site.repository ? `${site.repository.replace(/\/$/, '')}/tree/${site.branch}/content/${story.id}` : null },
    themes: themeList(site.themes, ui, langs), defaultTheme: story.theme ?? site.theme,
    topo, land: { type: 'Feature', properties: {}, geometry: land.geometry }, hill, labels,
    zones: Object.fromEntries(Object.values(zones).map(z => [z.id, { family: z.family, name: z.name, geometry: turf.truncate(z.feature, { precision: 4 }).geometry }])),
    routes, markers, battles, images, icons, pages: pages.map(({ dir, ...p }) => p), tree: navTree(tree),
  };
  const familyCss = Object.entries(story.families).map(([f, c]) => `--z-${f}:${c.color};`).join('');
  const familyCssDark = Object.entries(story.families).map(([f, c]) => `--z-${f}:${c.color_dark ?? c.color};`).join('');
  const page = APP.replace('/*__FAMILY_CSS__*/', familyCss).replaceAll('/*__FAMILY_CSS_DARK__*/', familyCssDark)
    .replace('/*__THEMES_CSS__*/', themeCss(site.themes, bundle.defaultTheme))
    .replace('const BUNDLE = null;', 'const BUNDLE = ' + JSON.stringify(bundle) + ';');
  fs.writeFileSync(path.join(out, 'index.html'), page);
  log(`  wrote dist/${story.id}/index.html (${(fs.statSync(path.join(out, 'index.html')).size / 1e6).toFixed(1)} MB, ${pages.length} pages, ${langs.join('/')})`);

  // card for the site index; span is story.span, else the years from the pages' when fields, else the first page's date
  const dated = pages.filter(p => p.when);
  const years = dated.length ? [...new Set([dated[0].when.from.slice(0, 4), dated[dated.length - 1].when.to.slice(0, 4)])].join(' – ') : null;
  const span = story.span ? T(story.span, 'story.span') : Object.fromEntries(langs.map(l => [l, years ?? pages[0].date[l]]));
  const summary = story.summary ? T(story.summary, 'story.summary') : {};
  // translation coverage per language; --strict turns a gap into an error
  for (const [lang, r] of Object.entries(report())) {
    log(`  ${lang}: ${r.total - r.missing.length} of ${r.total} strings translated${r.missing.length ? `, ${r.missing.length} missing (harita i18n ${lang})` : ''}`);
    if (p.strict && r.missing.length) fail(where, `${lang}: ${r.missing.length} strings missing, first: ${r.missing.slice(0, 8).join(', ')}`);
  }
  return { id: story.id, title: bundle.title, summary, span, languages: langs, pages: pages.length, cover, i18n: [...entries.values()] };
}

// The site index. site.yaml is optional: the folder name, alphabetical order and the cool theme stand in.
function buildIndex(p, cards, site) {
  const langs = site.languages ?? [...new Set(cards.flatMap(c => c.languages))];
  const defaultLang = site.default_language ?? langs[0];
  const order = site.stories ?? cards.map(c => c.id);
  for (const id of order) if (!cards.find(c => c.id === id)) fail('site.yaml', `unknown story "${id}"`);
  const { tr: T, entries, report } = translator({ langs, defaultLang, catalogues: loadCatalogues(path.join(p.root, 'i18n'), langs, p.loadYaml), where: 'i18n', fail });
  const ui = uiFor(langs, p.root, p.log);
  const data = {
    title: T(site.title, 'site.title'), intro: site.intro ? T(site.intro, 'site.intro') : {},
    languages: langs, defaultLanguage: defaultLang, ui, repository: site.repository ?? null,
    stories: order.map(id => { const { i18n, ...card } = cards.find(c => c.id === id); return card; }),
    themes: themeList(site.themes, ui, langs), defaultTheme: site.theme,
  };
  for (const [lang, r] of Object.entries(report())) {
    if (r.missing.length) p.log(`site ${lang}: ${r.missing.length} of ${r.total} strings missing (harita i18n ${lang})`);
    if (p.strict && r.missing.length) fail('site.yaml', `${lang}: missing ${r.missing.join(', ')}`);
  }
  p.siteEntries = [...entries.values()];
  fs.writeFileSync(path.join(p.dist, 'index.html'), INDEX.replace('const SITE = null;', 'const SITE = ' + JSON.stringify(data) + ';').replace('/*__THEMES_CSS__*/', themeCss(site.themes, site.theme)));
  p.log(`wrote dist/index.html (${data.stories.length} stories)`);
}

// Build every story under root/content into root/dist. Returns the dist folder and one card per story.
export function build({ root = process.cwd(), log = console.log, strict = false } = {}) {
  const p = project(root, log);
  p.strict = strict;
  const stories = listDirs(p.content).filter(d => exists(path.join(p.content, d, 'story.yaml')));
  if (!stories.length) fail('content/', 'no story.yaml found, run this from a content project');
  const siteFile = path.join(root, 'site.yaml');
  const siteMeta = exists(siteFile) ? p.readYaml(siteFile, Site) : {};
  const builtIn = check(Themes, p.loadYaml(path.join(PKG, 'src', 'themes.yaml')), 'src/themes.yaml');
  const site = { ...siteMeta, title: siteMeta.title ?? path.basename(root), theme: siteMeta.theme ?? 'cool', themes: { ...builtIn, ...(siteMeta.themes ?? {}) } };
  if (!site.themes[site.theme]) fail('site.yaml', `unknown theme "${site.theme}"`);
  const cards = [];
  for (const s of stories) { log(`story ${s}`); cards.push(buildStory(p, path.join(p.content, s), site)); }
  buildIndex(p, cards, site);
  return { dist: p.dist, stories: cards.map(({ i18n, ...card }) => card), i18n: { stories: Object.fromEntries(cards.map(c => [c.id, c.i18n])), site: p.siteEntries } };
}
