#!/usr/bin/env node
// harita build | dev | i18n | hillshade | patterns, run from a content project folder.
import { build, dev, hillshade, patterns, i18n } from '../src/index.mjs';

const USAGE = 'usage: harita build [--strict] | harita dev | harita i18n <lang> [--story id] | harita hillshade --bbox w,s,e,n [--zoom 7] [--out geo/hillshade.png] | harita patterns [--fix]';
const [cmd, ...rest] = process.argv.slice(2);
// --key value pairs; a --flag with no value, or followed by another --flag, reads as true
const opt = Object.fromEntries(rest.map((a, i) => a.startsWith('--') ? [a.slice(2), rest[i + 1]?.startsWith('--') ? true : rest[i + 1] ?? true] : null).filter(Boolean));
try {
  if (cmd === 'build') build({ strict: opt.strict === true });
  else if (cmd === 'i18n' && rest[0] && !rest[0].startsWith('--')) i18n({ lang: rest[0], story: typeof opt.story === 'string' ? opt.story : undefined });
  else if (cmd === 'dev') dev();
  else if (cmd === 'hillshade' && typeof opt.bbox === 'string') await hillshade({ bbox: opt.bbox.split(',').map(Number), zoom: opt.zoom ? Number(opt.zoom) : undefined, out: opt.out });
  else if (cmd === 'patterns') {
    const left = patterns({ fix: opt.fix === true });
    if (left.length && !opt.fix) { console.log('run harita patterns --fix to write the suggested patterns into story.yaml'); process.exit(1); }
  }
  else { console.error(USAGE); process.exit(2); }
} catch (err) { // content errors are expected, print them without a stack trace
  console.error(`error: ${err.message}`);
  process.exit(1);
}
