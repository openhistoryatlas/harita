// harita i18n <lang> [--story id]: write or refresh the translation catalogues for one language.
// Runs the build quietly to collect every translatable string, then writes content/<story>/i18n/<lang>.yaml
// per story and i18n/<lang>.yaml for the site, keeping translations that are already there.
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { build } from './build.mjs';
import { flatten, catalogueText } from './i18n.mjs';

export function i18n({ root = process.cwd(), lang, story, log = console.log } = {}) {
  if (!lang) throw new Error('usage: harita i18n <lang> [--story id]');
  const r = build({ root, log: () => {} });
  const written = [];
  const write = (file, entries, heading) => {
    const existing = fs.existsSync(file) ? flatten(yaml.load(fs.readFileSync(file, 'utf8')) ?? {}) : {};
    const { text, filled, total } = catalogueText(lang, entries, existing, heading);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    log(`wrote ${path.relative(root, file)}: ${filled} of ${total} strings translated`);
    written.push(file);
  };
  for (const [id, entries] of Object.entries(r.i18n.stories)) {
    if (story && id !== story) continue;
    write(path.join(root, 'content', id, 'i18n', lang + '.yaml'), entries, `${lang} strings for the story "${id}".`);
  }
  if (!story) write(path.join(root, 'i18n', lang + '.yaml'), r.i18n.site, `${lang} strings for the site.`);
  return written;
}
