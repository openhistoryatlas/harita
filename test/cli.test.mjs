// The harita command: exit codes and the usage line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import { build } from '../src/index.mjs';

const BIN = fileURLToPath(new URL('../bin/harita.mjs', import.meta.url));
const EXAMPLE = fileURLToPath(new URL('../example/', import.meta.url));
const run = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });

test('no command prints usage and exits 2', () => {
  const r = run(os.tmpdir());
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^usage: harita build/);
});

test('an unknown flag prints the usage and exits 2', () => {
  const r = run(os.tmpdir(), 'build', '--strcit');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown option '--strcit'/);
  assert.match(r.stderr, /usage: harita build/);
});

test('build in a folder without content exits 1 with the error alone', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harita-cli-'));
  const r = run(root, 'build');
  assert.equal(r.status, 1);
  assert.equal(r.stderr, 'error: content/: no story.yaml found, run this from a content project\n');
});

test('build in the example exits 0 and writes dist/', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harita-cli-'));
  fs.cpSync(EXAMPLE, root, { recursive: true });
  // fill the elevation cache with a stand-in tile first, so the command finds every tile and stays offline
  const tile = PNG.sync.write(new PNG({ width: 256, height: 256 }));
  await build({ root, log: () => {}, elevation: async () => tile });
  const r = run(root, 'build');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /wrote dist\/settlement-of-iceland\/index\.html/);
  assert.ok(fs.existsSync(path.join(root, 'dist/index.html')));
  assert.equal(run(root, 'patterns').status, 0);
});
