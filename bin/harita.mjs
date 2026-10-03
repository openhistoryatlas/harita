#!/usr/bin/env node
// harita build | dev | i18n | patterns, run from a content project folder.
import { parseArgs } from 'util';
import { build, dev, patterns, i18n } from '../src/index.mjs';

const USAGE = 'usage: harita build [--strict] | harita dev | harita i18n <lang> [--story id] | harita patterns [--fix]';
let args;
try {
  args = parseArgs({ allowPositionals: true, options: { strict: { type: 'boolean' }, fix: { type: 'boolean' }, story: { type: 'string' } } });
} catch (err) { // an unknown or incomplete flag
  console.error(`${err.message}\n${USAGE}`);
  process.exit(2);
}
const { positionals: [cmd, lang], values: opt } = args;
try {
  if (cmd === 'build') await build({ strict: opt.strict });
  else if (cmd === 'i18n' && lang) i18n({ lang, story: opt.story });
  else if (cmd === 'dev') dev();
  else if (cmd === 'patterns') {
    const left = patterns({ fix: opt.fix });
    if (left.length && !opt.fix) { console.log('run harita patterns --fix to write the suggested patterns into story.yaml'); process.exit(1); }
  }
  else { console.error(USAGE); process.exit(2); }
} catch (err) { // content errors are expected, print them without a stack trace
  console.error(`error: ${err.message}`);
  process.exit(1);
}
