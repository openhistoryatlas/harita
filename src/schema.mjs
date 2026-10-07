// Shapes of the content files. Cross references between files are checked in build.mjs.
import { z } from 'zod';

// A plain string applies to every language; an object holds one string per language code.
export const Translatable = z.union([z.string(), z.record(z.string().min(2).max(8), z.string())]);
const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes only');
const Lang = z.string().regex(/^[a-z]{2}(-[A-Za-z]{2,4})?$/, 'a language code like en or pt-BR');
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a hex colour like #a06b1f');
const Lon = z.number().min(-180).max(180);
const Lat = z.number().min(-90).max(90);
export const Bbox = z.tuple([Lon, Lat, Lon, Lat]).refine(([w, s, e, n]) => w < e && s < n, 'bbox is [west, south, east, north]');
// a year, a year-month, or a full date; YAML hands over a Date for the full form
const When = z.union([z.number().int(), z.string(), z.date()]).transform(v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v))
  .refine(s => /^\d{4}(-\d{2})?(-\d{2})?$/.test(s), 'YYYY, YYYY-MM or YYYY-MM-DD');

// land: up to eight tints for the countries, neighbours get different ones; without it every country is paper2
const ThemeTokens = z.object({ paper: Hex, paper2: Hex, sea: Hex, ink: Hex, ink2: Hex, rule: Hex, accent: Hex, panel: Hex, route: Hex, border: Hex, land: z.array(Hex).min(2).max(8).optional() }).strict();
export const Theme = z.object({ name: Translatable.optional(), light: ThemeTokens, dark: ThemeTokens }).strict();
export const Themes = z.record(Id, Theme);

export const Site = z.object({
  title: Translatable.optional(),
  intro: Translatable.optional(),
  languages: z.array(Lang).min(1).optional(),
  default_language: Lang.optional(),
  stories: z.array(Id).optional(),
  theme: Id.optional(),
  themes: Themes.optional(),
  url: z.string().url().optional(), // where the site is published, for canonical links, sitemaps and llms.txt
  repository: z.string().url().optional(), // the content repository: a Contribute link on the main page, a source link per story
  branch: z.string().default('main'),
}).strict();

export const Story = z.object({
  id: Id,
  title: Translatable,
  summary: Translatable.optional(),
  span: Translatable.optional(),
  cover: z.string().optional(),
  languages: z.array(Lang).min(1),
  default_language: Lang.optional(),
  extent: Bbox,
  land: z.array(z.string()).min(1),
  countries: z.array(z.string()).min(1),
  hillshade: z.string().optional(), // read by harita 0.2.4 and earlier; the build asks for its removal
  families: z.record(Id, z.object({ priority: z.number().int(), color: Hex, color_dark: Hex.optional(), pattern: z.enum(['hatch', 'cross', 'dots']).optional() }).strict()),
  smoothing: z.number().int().min(0).max(10).default(4),
  max_zoom: z.number().min(11).max(16).default(11), // battle plans need more; the relief tiles follow it to zoom 15
  theme: Id.optional(),
  // country names on the map; names overrides the Natural Earth name, hide leaves a country unlabelled
  labels: z.object({ countries: z.boolean().default(false), names: z.record(z.string(), Translatable).default({}), hide: z.array(z.string()).default([]) }).strict().optional(),
}).strict();

export const Group = z.object({ title: Translatable.optional() }).strict();

export const Image = z.object({ file: z.string(), caption: Translatable, credit: Translatable.optional() }).strict();
export const Images = z.record(Id, Image);

// A tilted 3D view over the terrain: pitch from straight down, bearing clockwise from north, heights times exaggeration.
export const Camera = z.object({ pitch: z.number().min(10).max(60).default(50), bearing: z.number().min(-180).max(180).default(0), exaggeration: z.number().min(0.5).max(5).default(2) }).strict();

export const Page = z.object({
  date: Translatable,
  title: Translatable,
  when: z.union([When, z.object({ from: When, to: When.optional() }).strict()]).optional(),
  bbox: Bbox,
  zones: z.array(Id).default([]),
  routes: z.array(Id).default([]),
  markers: z.array(Id).default([]),
  battle: Id.optional(), // one battle per page keeps the map readable
  camera: z.union([z.literal(false), Camera]).optional()
    .refine(c => c !== false, 'pages open flat until the reader picks 3D, so camera: false has no use: remove it'),
  // an emblem drawn on the map while the page is open: plugins/emblems/<kind>.mjs, else one harita ships
  emblem: z.object({ kind: Id }).passthrough().optional(),
  images: Images.default({}),
  sources: z.array(Translatable).default([]),
  // map data the page draws beyond the base map, credited in an "Other sources" popup on the map
  map_sources: z.array(z.object({ text: Translatable, url: z.string().url().optional() }).strict()).default([]),
}).strict();

// The battle-plan emblem: troops, movements, water and works at one moment of a battle. Sizes are in metres.
export const UNIT_TYPES = ['infantry', 'cavalry', 'knights', 'pikes', 'light', 'archers', 'irregular', 'elephants', 'chariots', 'siege', 'artillery',
  'armour', 'aircraft', 'ships', 'submarines', 'camp', 'square', 'fort'];
const LngLat = z.tuple([Lon, Lat]);
const Piece = { name: Translatable.optional(), id: z.string().min(1).optional() }; // a named piece shows on pointing
const PlanSide = z.string().min(1); // a family of the story, neutral or a hex colour, checked when drawing
const Size = z.number().positive();
export const BattlePlan = z.object({
  kind: z.literal('battle-plan'),
  land: z.array(z.object({ area: z.array(LngLat).min(3) }).strict()).default([]),
  water: z.array(z.union([
    z.object({ path: z.array(LngLat).min(2), width: Size.optional(), ...Piece }).strict(),
    z.object({ area: z.array(LngLat).min(3), ...Piece }).strict(),
  ])).default([]),
  works: z.array(z.object({ side: PlanSide.optional(), path: z.array(LngLat).min(2), width: Size.optional(), style: z.enum(['wall', 'trench']).optional(), ...Piece }).strict()).default([]),
  units: z.array(z.object({
    side: PlanSide, type: z.enum(UNIT_TYPES).default('infantry'), at: LngLat, width: Size, depth: Size.optional(),
    facing: z.number().optional(), bow: z.number().optional(), count: z.number().int().positive().optional(), rows: z.number().int().positive().optional(), ...Piece,
  }).strict()).default([]),
  arrows: z.array(z.object({ side: PlanSide, path: z.array(LngLat).min(2), width: Size.optional(), style: z.enum(['solid', 'dashed', 'fire']).optional(), ...Piece }).strict()).default([]),
  clashes: z.array(z.union([LngLat, z.object({ at: LngLat, size: Size.optional() }).strict()])).default([]),
}).strict().refine(p => p.water.length + p.works.length + p.units.length + p.arrows.length + p.clashes.length > 0, 'a battle plan needs water, works, units, arrows or clashes');

export const Markers = z.record(Id, z.object({
  lnglat: z.tuple([Lon, Lat]),
  icon: z.string().default('flag'), // a Lucide icon name, checked in the build
  color: Id.optional(),
  image: Id.optional(),
  label: Translatable,
  note: Translatable.default(''),
}).strict());

// A battle in the shape of a Wikipedia infobox, shown as a card on the map.
const Side = z.object({
  name: Translatable,
  color: z.string().optional(), // a family id or a hex colour
  commanders: z.array(Translatable).default([]),
  strength: Translatable.optional(),
  casualties: Translatable.optional(),
}).strict();
export const Battles = z.record(Id, z.object({
  lnglat: z.tuple([Lon, Lat]),
  name: Translatable,
  date: Translatable,
  result: Translatable.optional(),
  sides: z.array(Side).min(1).max(3),
  images: z.array(Id).default([]), // shown in the card, one at a time with arrows
  source: z.string().url().optional(),
  front: z.array(z.tuple([Lon, Lat])).min(2).optional(), // a line drawn while the battle is on the page
}).strict());

const Ring = z.array(z.tuple([Lon, Lat])).min(4);
export const Zone = z.object({
  type: z.literal('Feature'),
  properties: z.object({ id: Id.optional(), family: Id, name: Translatable, clip: z.array(z.string()).optional() }).strict(), // clip: countries, else the story's land
  geometry: z.object({ type: z.literal('Polygon'), coordinates: z.array(Ring).min(1) }),
});
export const Route = z.object({
  type: z.literal('Feature'),
  properties: z.object({ id: Id.optional(), name: Translatable, style: z.enum(['solid', 'dashed']).default('solid'), arrows: z.boolean().default(true), offset: z.number().min(-20).max(20).default(0) }).strict(),
  geometry: z.object({ type: z.literal('LineString'), coordinates: z.array(z.tuple([Lon, Lat])).min(2) }),
});

// Parse or throw one error that names the file and every bad field.
export function check(schema, data, file) {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const lines = r.error.issues.map(i => `  ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);
  throw new Error(`${file}:\n${lines.join('\n')}`);
}
