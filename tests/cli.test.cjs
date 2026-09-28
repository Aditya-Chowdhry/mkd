const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArguments, launchPlan } = require('../bin/mkd.cjs');
const { documentFromArguments } = require('../electron/arguments.cjs');

test('resolves relative paths, spaces, and dash-prefixed names from the caller directory', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mkd-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ['my notes.md', '-notes.md', 'README']) fs.writeFileSync(path.join(directory, name), '# Notes');
  assert.equal(parseArguments(['my notes.md'], directory).file, path.join(directory, 'my notes.md'));
  assert.equal(parseArguments(['--', '-notes.md'], directory).file, path.join(directory, '-notes.md'));
  assert.equal(parseArguments(['README'], directory).file, path.join(directory, 'README'));
  assert.throws(() => parseArguments(['missing.md'], directory), /File not found/);
  assert.throws(() => parseArguments([directory]), /Not a file/);
  assert.throws(() => parseArguments(['one.md', 'two.md']), /one file at a time/);
});

test('help and version work without opening the app', () => {
  const cli = path.resolve('bin/mkd.cjs');
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: mkd/);
  const version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), require('../package.json').version);
  const invalid = spawnSync(process.execPath, [cli, '--unknown'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown option/);
});

test('macOS uses Launch Services to reuse the existing app', () => {
  const plan = launchPlan('/notes/file with spaces.md', {
    platform: 'darwin', appPath: '/Applications/Mkd.app', exists: () => true,
  });
  assert.deepEqual(plan, { command: '/usr/bin/open', args: ['-a', '/Applications/Mkd.app', '/notes/file with spaces.md'], wait: true });
});

test('Windows and Linux pass file paths as separate arguments without a shell', () => {
  for (const platform of ['win32', 'linux']) {
    const plan = launchPlan('/notes/a file.md', { platform, appPath: '/app/mkd', exists: () => true });
    assert.deepEqual(plan.args, ['--open-file', '/notes/a file.md']);
    assert.equal(plan.wait, false);
  }
});

test('falls back to the development runtime and explains missing builds', () => {
  const project = '/project';
  const present = new Set(['/project/dist/index.html', '/project/node_modules/electron/dist/electron']);
  const plan = launchPlan('/notes/file.md', { platform: 'linux', root: project, appPath: '', exists: p => present.has(p) });
  assert.deepEqual(plan.args, [project, '--open-file', '/notes/file.md']);
  assert.throws(() => launchPlan(null, { root: project, appPath: '', exists: () => false }), /Build Mkd first/);
  assert.throws(() => launchPlan(null, { appPath: '/missing', exists: () => false }), /MKD_APP does not exist/);
});

test('desktop receives extensionless filenames and resolves second-instance relative paths', () => {
  assert.equal(documentFromArguments(['--open-file', 'README'], '/notes'), path.resolve('/notes/README'));
  assert.equal(documentFromArguments(['draft.txt'], '/notes'), path.resolve('/notes/draft.txt'));
  assert.equal(documentFromArguments(['--open-file']), null);
  assert.equal(documentFromArguments(['--user-data-dir=/tmp/profile.md']), null);
});

test('CLI launches from another directory without interpreting shell characters', { skip: process.platform === 'win32' }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mkd-cli-spawn-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = 'my $(notes); draft.md';
  const output = path.join(directory, 'received.json');
  const executable = path.join(directory, 'fake-app');
  fs.writeFileSync(path.join(directory, target), '# Test');
  fs.writeFileSync(executable, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({args: process.argv.slice(2), runAsNode: process.env.ELECTRON_RUN_AS_NODE}));\n`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [path.resolve('bin/mkd.cjs'), target], {
    cwd: directory, env: { ...process.env, MKD_APP: executable, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  for (let attempt = 0; attempt < 100 && !fs.existsSync(output); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  const received = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.deepEqual(received.args, ['--open-file', path.join(fs.realpathSync(directory), target)]);
  assert.equal(received.runAsNode, undefined);
});
