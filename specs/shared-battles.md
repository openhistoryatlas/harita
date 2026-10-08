# Shared battles

A battle is a folder that holds everything about it: the infobox, its pages with text and battle plans, its
images, markers, routes and translations. A story plugs the battle into its page tree with one file. Two stories
that cover the same battle, such as one on Bayezid I and one on Timur for Ankara 1402, use one folder.

## Layout

A battle lives in one of two places:

```
content/shared/battles/<id>/           used by any story
content/<story>/shared/battles/<id>/   used by that story alone
```

`content/shared/` is reserved for shared battles and holds no `story.yaml`. The folder name is the battle's id as
it stands: it matches the id pattern (lowercase letters, digits and dashes), and a number prefix stays part of it.
By convention the id ends in the year: `ankara-1402`, `kosovo-1389`, `cannae-216bc`. The build does not check the
year.

```
content/shared/battles/ankara-1402/
  battle.yaml            the infobox, default language, colours, zoom
  markers.yaml           optional, markers any page of the battle can show
  routes/*.geojson       optional, routes any page of the battle can show
  i18n/<lang>.yaml       the battle's catalogues
  pages/                 optional, the battle's pages
    010-armies/          page.yaml, text/<lang>.md
    020-deployment/      page.yaml, text/<lang>.md, and as on a story page markers.yaml, routes/
```

`battles.yaml` files go away, and existing ones are converted by hand. A battle is a folder in every case.

## battle.yaml

```yaml
lnglat: [32.95, 40.03]
name: Battle of Ankara
date: 20 July 1402
result: Timurid victory
source: https://en.wikipedia.org/wiki/Battle_of_Ankara
front: [[32.90, 40.05], [32.98, 40.00]]      # optional, drawn while a page shows the battle
default_language: en                         # optional, en by default, the language of the inline strings
max_zoom: 14                                 # optional, how close the battle's pages zoom, 11 to 16
families:                                    # optional, the colours the battle uses
  ottoman: { color: "#b8333a", color_dark: "#e0646a" }
  timurid: { color: "#2f6a9f", color_dark: "#6fa3d6" }
images: [bayezid-captive-5c01d7]             # optional, shown in the card in this order
sides:
  - name: Timurid Empire
    color: timurid                           # a family of this battle, or a hex colour
    commanders: [Timur, Shah Rukh]
    strength: 140,000
  - name: Ottoman Empire
    color: ottoman
    commanders: [Bayezid I]
```

The fields `lnglat`, `name`, `date`, `result`, `source`, `front` and `sides` keep their current meaning. Changes
from today's `battles.yaml` entry:

- `images` lists the card's images by id, see [Images](#images).
- `default_language`, `max_zoom` and `families` are new.
- A family in `families` has `color` and an optional `color_dark`. It has no `priority` or `pattern`, since
  those only apply to zones.

## Battle pages

A battle's `pages/` follows the format of a story's `pages/`: number prefixes set the order, a folder with
`page.yaml` is a page, any other folder is a header with an optional `group.yaml`. A battle without `pages/` only
has its card.

A battle page folder holds the same files as a story page folder: `page.yaml`, `text/<lang>.md`, and optionally
`images/`, `markers.yaml` and `routes/`. Everything it defines belongs to the battle, so `planWriter` works with a
battle folder as its root: `planWriter('content/shared/battles/cannae-216bc')`.

On a battle page, `page.yaml` works as on a story page, with these differences:

- A battle page has no `zones`. Its zones come from the story, see [Plugging a battle in](#plugging-a-battle-in).
- `markers` and `routes` name the markers and routes the battle defines. `@image` names an image folder: a shared
  battle sees `content/shared/images/`, a story's own battle also the story's.
- `battle: true` opens the battle's card. A battle plan page leaves the line out to keep the card closed.

## Plugging a battle in

A story places a battle's pages with a folder in its page tree that holds `include.yaml` and nothing else:

```yaml
# content/timur/pages/030-anatolia/040-ankara/include.yaml
battle: ankara-1402
zones: [timurid-1402, ottoman-1402]   # optional, story zones shown on every page of the battle
markers: [ankara]                     # optional, story markers shown on every page of the battle
```

- The folder's number prefix sets where the battle sits. The rest of the folder name is free text.
- The battle's pages appear there under a header with the battle's `name`. A battle with one page appears as that
  page, without a header. The header's title shows in the nav and the Markdown export.
- Each battle page shows the include's zones and markers, then the page's own markers.
- The build looks for the battle in `content/<story>/shared/battles/` and in `content/shared/battles/`.
- A story includes a battle at most once.

A story page that wants the card alone writes `battle: ankara-1402` in its `page.yaml`. The story needs no include
for that.

A story that includes or names a battle reads the whole battle folder, pages included, and checks all of it. Only
an include puts the battle's pages into the story.

The `when` order check runs over the story's pages and the battle's pages together, in the order the reader sees
them. The story author places the include. When the check fails on a battle page, the message names the include
folder to renumber, since renumbering the battle's own pages would move them in every story.

## Ids and scoping

Everything a battle folder defines belongs to the battle: its pages, markers and routes. Inside the battle, files
use the short ids (`markers: [camp]`). In the story's bundle each id becomes `<battle>/<id>`, for example
`ankara-1402/camp`, so a battle's ids and the story's ids stay apart. Story pages use the story's own ids. Images are
image folders with ids of their own, see [Images](#images).

- A battle page's id in the story is `<battle>-<page>`, for example `ankara-1402-deployment`, and its URL is
  `/timur/<lang>/ankara-1402-deployment/`. A clash with a story page id fails with the existing "two pages share
  the id" error.
- Battle pages keep the story's "Source on GitHub" link.

## Colours

A battle names colours by its own family ids. In the story's bundle every battle family becomes
`<battle>_<family>`, for example `ankara-1402_timurid`. Ids hold no underscores, so the name stays apart from the
story's families. The build picks its colour values:

1. from the story family with the same id, or with that id in its `aliases`,
2. else from the battle's own `families`, and the build warns once per story and family.

`aliases` is a new optional list on a family in `story.yaml`:

```yaml
families:
  timur: { priority: 1, color: "#2f6a9f", aliases: [timurid] }
```

With the alias, the battle's `timurid` sides, plan units and markers take the colours of the story's `timur`, so
the story's zones and the battle match. The alias lives in `story.yaml` so that it also applies to a battle the
story only shows as a card.

Emblems on battle pages:

- The emblem plugin receives the battle's `families`, keyed by the battle's ids, so `side: timurid` in a battle
  plan checks against the battle.
- The build renames each returned feature's `family` to `<battle>_<family>`. The reader then colours it from the
  bundle's family table, and the theme switch works as for story families.
- A battle plan's water takes the battle's `water` family when it has one, else the built-in blue.

Inside the battle, every family a side, plan unit, plan arrow, plan work or marker names must be in the battle's
`families`, or be `neutral` or a hex colour where those are allowed today. This makes the battle valid on its own,
whatever story includes it.

## Languages and catalogues

A battle's inline strings are in its `default_language`. Other languages come from `i18n/<lang>.yaml` in the
battle folder, keyed without the battle id:

| Where the English is | Key |
|---|---|
| `battle.yaml` | `battle.name`, `battle.date`, `battle.result`, `battle.sides.<n>.name`, `.commanders.<m>`, `.strength`, `.casualties` |
| markers, routes | `markers.<id>.label`, `markers.<id>.note`, `routes.<id>.name` |
| headers in `pages/` | `groups.<id>.title` |
| pages | `pages.<id>.date`, `.title`, `.sources.<n>`, `.map_sources.<n>` |
| emblem feature names | `emblems.<page id>.<feature id>` |

The page ids in these keys are the short ones (`pages.deployment.title`).

The battle shows in every language of the story that uses it:

- A missing catalogue string shows the default language and counts as missing in the coverage.
- A missing `text/<lang>.md` shows the default language text. The text element then carries the default
  language in its `lang` attribute. The build warns once per story, battle and language, naming the pages.
- The build prints a coverage line per battle and language, beside the story's lines:
  `battle ankara-1402 tr: 20 of 24 strings translated`.
- `--strict` fails on a missing string or a missing text in a battle, as it does for a story.
- `harita i18n <lang>` writes `i18n/<lang>.yaml` in every battle a story uses, for every language other than the
  battle's default. The entries come from the whole battle folder, however the story uses it, so a story that
  shows the card alone keeps the page keys. A battle used by two stories gets one catalogue. The command keys its
  output by battle folder, so two stories may each hold a battle of their own with the same id.
- `harita i18n <lang> --story <id>` writes the catalogues of the battles that story uses.

## Images

Every image is a folder of its own and is stored once. Page images in `page.yaml`, a story's `shared/images.yaml`
and cover files go.

```
content/shared/images/<id>/           any story or battle can show it
content/<story>/shared/images/<id>/   that story and its own battles can show it
  image.<ext>                         the file
  image.yaml                          caption, credit, source, sha256, default_language (en by default)
  i18n/<lang>.yaml                    image.caption, image.credit
```

- The folder name is the id: a name and six hex digits, `hastings-knights-3f9a1c`, so images added at the same
  time on different branches get different folders. The build checks the suffix.
- `source` is the page the file came from, such as its Commons file page. Sources compare as pages: decoded, with
  spaces as underscores. `sha256` is the file's.
- `harita image <file> <name> --caption <text> [--credit <text>] [--source <url>] [--story <id>]` looks through
  every image folder for the same source, then the same bytes (a stored `sha256`, or the file hashed when there is
  none, after a size match). A match is used again, and one in another story's folder moves to
  `content/shared/images/`. Else it makes a folder with a fresh suffix, writes `source` and `sha256`, and prints the
  id. The library exports `image()`, and `imageIndex()` with `findImage()` for download scripts.
- `harita rehash` writes the `sha256` of every image folder where it is missing or stale. `harita build --strict`
  fails on an image it ships without a `sha256` or with one that does not match the file.
- A text (`@image`), a marker (`image:`), a battle card (`images`) or a story's `cover` names it by id. A story
  sees its own image folders and the shared ones.
- A story's `dist/<story>/images/` holds the story's images it shows, and `dist/images/` the shared ones, once for
  the whole site. `dist/images/` drops an image no story shows.
- `harita i18n <lang>` writes each image folder's catalogue. The build prints one coverage line per language for
  the image folders a story shows, and `--strict` fails on a gap.
- Errors: a folder name without the suffix, a missing `image.yaml`, no image file or more than one, an id in
  two places a scope sees, `images:` in a `page.yaml`, a `shared/images.yaml`, a cover that is not an image id.

## Shared zones

A zone several stories show lives in `content/shared/zones/<id>/zone.geojson`, with `i18n/<lang>.yaml` for
`zone.name`. A page or an include names it by id. Its family resolves through the story's ids and aliases, and a
story without the family fails. The story trims it with its own zones, so `dist/` holds one cleaned shape per story.

`harita zones` reports the zones of different stories that look like one region:

1. A hash of each drawing, rounded to about 10 m with repeated points dropped, rings turned one way and started
   at their lowest point, finds copies with one map read.
2. Each zone cut to Natural Earth land at 1:50m, simplified to about 500 m, gives the land it covers.
3. An R-tree over the land boxes gives the pairs that can meet, and a pair whose land areas differ by more than
   10% cannot reach the threshold, so it is skipped.
4. The overlap is the land both cover over the land either covers: 0.9 is reported, 0.98 is the same land.
5. The widest gap between the borders, from each drawn point on land to the other drawing, gives km and a place.

Land cuts and overlaps are cached in `.cache/harita/zone-compare.json` by the drawings they come from. Pairs within
one story need `--same-story`. `--like <file>` checks a zone before it is added, and `--share <story>/<id> --replace
<story>/<id>` moves a zone into `content/shared/zones/` and points the other story at it. `.cache/harita/zones.html`
shows each pair over the land. `harita build --strict` fails on copies and warns about the other pairs.

### Zone overrides, the apart list and groups

- A story's `zones.yaml` (in `shared/` or a page folder) gives zones that take another zone's outline, of the story
  or shared, with their own `name` or `family`: `sicily-970: { zone: sicily, name: Emirate of Sicily, family:
  islam }`. An entry's clip is its own `clip`, else the story's land, never the clip of the zone it names. The colour and pattern come from the family, the name is translated in the story's catalogue.
- `--share` leaves the source story's pages as they are. Each `--replace` zone becomes a `zones.yaml` entry with its
  id, name and family, and takes the shared outline.
- `content/shared/zones/apart.yaml` lists pairs checked and kept apart, with why and both drawings' hashes.
  `harita zones --apart <zone> <zone> --why <text>` adds one. A listed pair comes back once either zone is redrawn,
  an entry whose zone is gone is reported, and a copy cannot be listed.
- Battle, image and zone folders can sit in groups at any depth. The folder that holds `battle.yaml`, `image.yaml`
  or `zone.geojson` is the item and gives the id, unique across the groups of a library. Story `zones/` folders
  take subfolders too.

## Zoom and relief

A battle plan needs a closer zoom than most stories allow. A battle page's max zoom is the larger of the story's
`max_zoom` and the battle's, and the story's when the battle sets none. Every other page and the overview keep the
story's `max_zoom`.

- The bundle gives each page a `maxZoom`. `app.js` sets the map's max zoom per page instead of once at load. While
  the map flies between two pages it uses the larger of the two, then settles on the new page's value.
- `terrainPlan` takes a max zoom per page bbox, so the relief tiles follow each page's zoom.

## Commands

- `harita build` reads every battle a story includes or names, as part of the story. A battle that no story uses
  is not read.
- `harita check` covers the battles the story uses. Page ids in `harita check <story> [page id ...]` take the long
  form for battle pages (`ankara-1402-deployment`). `battle.yaml` and the battle's root markers and routes are
  always in scope, like the story's `shared/`.
- `harita dev` stays as it is. A change under `content/shared/` rebuilds every story, a change under
  `content/<story>/` rebuilds that story.
- `harita patterns` expands includes, so each battle page counts with the include's zones.

## Library API

`schema.Battles` goes. `src/schema.mjs` exports `Battle` for `battle.yaml` and `Include` for `include.yaml`, and
`Story` gains `aliases` on a family. `Page.battle` takes an id on a story page and `true` on a battle page.

## Build checks

Errors, each naming the file:

- a `battles.yaml` anywhere under `content/`: the message names the battle folder layout that replaces it
- a `content/shared/story.yaml`: the message says the folder is reserved for shared battles
- a battle folder name outside the id pattern
- an include or `battle:` naming a battle that exists in neither place
- a battle id in both `content/<story>/shared/battles/` and `content/shared/battles/`
- an include folder holding more than `include.yaml`, a story including the same battle twice, or an
  `include.yaml` inside a battle's `pages/`
- an include of a battle without `pages/`
- an unknown zone or marker in `include.yaml`, naming `include.yaml`
- `zones` on a battle page, with a pointer to `include.yaml`, or a `zones/` folder anywhere in a battle
- `battle: true` on a story page, or a battle id on a battle page
- an alias equal to another family's id in the story, or listed by two families
- a battle family that a side, plan piece or marker uses and `families` lacks
- a short id inside a battle that the battle does not define

Warnings, printed with the story's other warnings:

- a battle family that takes the battle's own colour in a story
- a battle page without text in a story language

## Example project

The example story gains a shared battle, `content/shared/battles/althing-1012/`, made from today's
`pages/040-althing-battle/`. Its card shows both sides, and its `Öxará` water stays in the plan. The battle has two
pages: `010-assembly` opens the card over the Þingvellir plain with the text, and `020-fight` holds the battle
plan. The story includes it from `pages/040-althing-battle/include.yaml` with `markers: [thingvellir]`.

## Tests

New:

- a battle in `content/shared/` included by two stories builds in both, with one set of strings
- a story page with `battle:` alone shows the card and no battle pages
- the `when` check fails on an include placed after a later page, and names the include folder
- a battle family takes the story family's colour by id and by alias, and the battle's colour with a warning
- a battle plan's features carry `<battle>_<family>` and follow the theme
- a story's image folder ships in `dist/<story>/images/` and a shared one in `dist/images/`, in the Markdown export and
  og:image too
- a missing battle text falls back with a warning and a `lang` attribute, and `--strict` fails
- `harita i18n` writes the battle's catalogue once, and a story that shows the card alone keeps the page keys
- a battle page's `maxZoom` and the relief tiles follow the battle's `max_zoom`
- `harita patterns` sees the include's zones on battle pages
- each error in [Build checks](#build-checks)

Existing tests that change:

- tests that name the page `althing-battle` move to `althing-1012-fight`, including `test/plans.test.mjs`, which
  points `planWriter` at the battle folder
- the helpers that add a language (`test/build.test.mjs` around lines 182, 260 and 331) also add the battle's
  `text/<lang>.md`, so strict builds reach what they assert
- `trilingual()` (around line 409) skips include folders and adds the battle's texts
- the skirmish tests (around lines 238 and 332) write a battle folder in place of `shared/battles.yaml`

## README

- Battles: rewrite for battle folders, `include.yaml`, ids and colours.
- Content layout: add `content/shared/battles/` and the battle folder.
- Languages: replace the battles row with a pointer to the battle catalogues.
- story.yaml: add `aliases`.
- Emblems: on a battle page, `families` is the battle's families.
- Battle plans: `planWriter` takes a battle folder.
- Relief and 3D: a battle's `max_zoom`.
- The README describes the working path. The error messages carry the failure cases.

## Out of scope

- story text inside a battle: a story adds its own pages before or after the include
- including part of a battle's pages
- story pages naming a battle's markers or routes
- story routes on battle pages
- zones defined inside a battle
- a check on the year suffix
- a source link per battle page
