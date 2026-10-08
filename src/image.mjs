// Image folders: content/shared/images/<id>/ for every story, content/<story>/shared/images/<id>/ for one. Each holds
// image.<ext> and image.yaml with the caption, the credit, the source the file came from and the file's sha256.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import yaml from 'js-yaml';
import { libraryItems, isImage } from './folders.mjs';
import { check, ImageFolder } from './schema.mjs';
import { listDirs } from './util.mjs';

export const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// a source as a page address, so File%3AA%20b.jpg over http and File:A_b.jpg over https are one source, and
// object.php?id=101 and ?id=202 are two
const sameSource = url => { try { const u = new URL(url); return u.host + decodeURIComponent(u.pathname).replace(/ /g, '_') + u.search; } catch { return url; } };
const readMeta = dir => { try { return yaml.load(fs.readFileSync(path.join(dir, 'image.yaml'), 'utf8')) ?? {}; } catch { return {}; } };
// a field of image.yaml set in place, so the other lines and their comments stay
function setField(dir, key, value) {
  const file = path.join(dir, 'image.yaml'), text = fs.readFileSync(file, 'utf8'), line = `${key}: ${value}`;
  fs.writeFileSync(file, new RegExp(`^${key}:.*$`, 'm').test(text) ? text.replace(new RegExp(`^${key}:.*$`, 'm'), line) : text.replace(/\n?$/, '\n') + line + '\n');
}

// Every image folder the content holds, with its source and stored sha256.
export function imageIndex({ root = process.cwd() } = {}) {
  const content = path.join(root, 'content'), index = [];
  // the image folders of a library, in its groups too
  const folders = (dir, story) => {
    for (const [id, d] of libraryItems(dir, isImage, p => path.relative(root, p))) {
      const f = fs.readdirSync(d).find(f => /^image\.\w+$/.test(f) && f !== 'image.yaml');
      if (!f) continue;
      const m = readMeta(d);
      index.push({ id, story, dir: d, meta: fs.existsSync(path.join(d, 'image.yaml')), file: path.join(d, f), size: fs.statSync(path.join(d, f)).size, source: m.source ?? null, sha256: m.sha256 ?? null });
    }
  };
  folders(path.join(content, 'shared', 'images'), null);
  for (const s of listDirs(content).filter(s => fs.existsSync(path.join(content, s, 'story.yaml')))) folders(path.join(content, s, 'shared', 'images'), s);
  return index;
}

// The image the content already holds for a source or a file: the same source first, then the same bytes. Returns
// the index entry with by: 'source' or 'sha256', or null.
export function findImage(index, { source = null, file = null } = {}) {
  if (source) {
    const want = sameSource(source), hit = index.find(i => i.source && sameSource(i.source) === want);
    if (hit) return { ...hit, by: 'source' };
  }
  if (file) {
    const size = fs.statSync(file).size, hash = sha256(file);
    // the size first, so only a file of the same length is hashed
    const hit = index.find(i => i.size === size && (i.sha256 ?? sha256(i.file)) === hash);
    if (hit) return { ...hit, by: 'sha256' };
  }
  return null;
}

// harita image: the folder that holds the same source or bytes, moved to content/shared/images/ when another story owns
// it, else a new one named <name>-<six random hex digits>, so branches adding images at once never clash. Returns the id.
export function image({ root = process.cwd(), file, name, caption, credit = null, source = null, story = null, log = console.log } = {}) {
  if (!file || !name || !caption) throw new Error('usage: harita image <file> <name> --caption <text> [--credit <text>] [--source <url>] [--story <id>]');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`"${name}": a name is lowercase letters, digits and dashes, such as hastings-knights`);
  if (!fs.existsSync(file)) throw new Error(`${file}: no such file`);
  if (!/\.(jpe?g|png|webp|svg|gif)$/i.test(file)) throw new Error(`${file}: an image is a .jpg, .jpeg, .png, .webp, .svg or .gif file`);
  if (story && !fs.existsSync(path.join(root, 'content', story, 'story.yaml'))) throw new Error(`"${story}" is not a story folder under content/`);
  const content = path.join(root, 'content');
  if (!fs.existsSync(content) || !fs.readdirSync(content).some(d => fs.existsSync(path.join(content, d, 'story.yaml')))) throw new Error('content/: no story.yaml found, run harita image from a content project');
  // the fields as image.yaml will hold them, checked before anything is written
  check(ImageFolder, { caption, ...(credit ? { credit } : {}), ...(source ? { source } : {}) }, '--caption, --credit and --source');
  const rel = p => path.relative(root, p), common = path.join(root, 'content', 'shared', 'images');
  const index = imageIndex({ root }), hit = findImage(index, { source, file });
  if (hit) {
    let dir = hit.dir;
    // a folder of another story moves where both stories see it, and every reference to it keeps working
    if (hit.story && hit.story !== story) {
      dir = path.join(common, hit.id);
      if (fs.existsSync(dir) || index.some(i => i.id === hit.id && i.dir !== hit.dir)) throw new Error(`${rel(hit.dir)} holds this image and another folder is named ${hit.id} too, keep one`);
      fs.mkdirSync(common, { recursive: true });
      fs.renameSync(hit.dir, dir);
      log(`moved ${rel(hit.dir)}/ to ${rel(dir)}/, it holds the same ${hit.by === 'source' ? 'source' : 'file'}`);
    } else log(`${rel(dir)}/ holds the same ${hit.by === 'source' ? 'source' : 'file'}`);
    if (source && !hit.source) setField(dir, 'source', source);
    log(`name it as ${hit.id}`);
    return hit.id;
  }
  const base = story ? path.join(root, 'content', story, 'shared', 'images') : common;
  let id;
  // a fresh suffix, unused in every library and group
  do id = `${name}-${crypto.randomBytes(3).toString('hex')}`; while (index.some(i => i.id === id));
  const dir = path.join(base, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(file, path.join(dir, 'image' + path.extname(file).toLowerCase()));
  // the caption is in the story's default language, or for a shared image the site's
  const settingsFile = story ? path.join(root, 'content', story, 'story.yaml') : path.join(root, 'site.yaml');
  const settings = fs.existsSync(settingsFile) ? yaml.load(fs.readFileSync(settingsFile, 'utf8')) ?? {} : {};
  const lang = settings.default_language ?? settings.languages?.[0] ?? 'en';
  fs.writeFileSync(path.join(dir, 'image.yaml'), yaml.dump({ caption, ...(credit ? { credit } : {}), ...(source ? { source } : {}),
    ...(lang !== 'en' ? { default_language: lang } : {}), sha256: sha256(file) }, { lineWidth: -1 }));
  log(`wrote ${rel(dir)}/, name it as ${id}`);
  return id;
}

// harita rehash: writes the sha256 of every image folder's file into its image.yaml where it is missing or no longer
// matches the file. Returns the folders it wrote.
export function rehash({ root = process.cwd(), log = console.log } = {}) {
  const written = [];
  for (const i of imageIndex({ root })) {
    if (!i.meta) { log(`${path.relative(root, i.dir)}: image.yaml is missing`); continue; }
    const hash = sha256(i.file);
    if (i.sha256 === hash) continue;
    setField(i.dir, 'sha256', hash);
    written.push(path.relative(root, i.dir));
  }
  log(`wrote the sha256 of ${written.length} image folder${written.length === 1 ? '' : 's'}`);
  return written;
}
