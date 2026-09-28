#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');

const help = `Usage: mkd [filename]

Open a Markdown file in Mkd, or launch the app without a file.
Relative paths are resolved from your current directory.

  mkd README.md
  mkd "notes/my ideas.md"
  mkd -- -notes.md

Options:
  -h, --help     Show this help
  -v, --version  Show the version

Set MKD_APP to use a specific app bundle or executable.
`;

function parseArguments(args, cwd = process.cwd()) {
  if (args.length === 1 && ['-h', '--help'].includes(args[0])) return { help: true };
  if (args.length === 1 && ['-v', '--version'].includes(args[0])) return { version: true };
  const literal = args[0] === '--';
  if (literal) args = args.slice(1);
  if (!literal && args.some(arg => arg.startsWith('-'))) throw new Error('Unknown option. Use mkd --help for usage, or -- before a filename starting with a dash.');
  if (args.length > 1) throw new Error('Open one file at a time. Quote paths containing spaces.');
  if (!args.length) return { file: null };
  const file = path.resolve(cwd, args[0]);
  let stat;
  try { stat = fs.statSync(file); }
  catch (error) { throw new Error(error.code === 'ENOENT' ? `File not found: ${file}` : `Cannot open ${file}: ${error.message}`); }
  if (!stat.isFile()) throw new Error(`Not a file: ${file}`);
  fs.accessSync(file, fs.constants.R_OK);
  return { file };
}

function launchPlan(file, options = {}) {
  const platform = options.platform || process.platform;
  const project = options.root || root;
  const exists = options.exists || fs.existsSync;
  const override = options.appPath ?? process.env.MKD_APP;
  const home = options.home || os.homedir();
  const candidates = platform === 'darwin'
    ? ['release/mac-arm64/Mkd.app', 'release/mac/Mkd.app', 'release/mac-universal/Mkd.app'].map(p => path.join(project, p)).concat('/Applications/Mkd.app', path.join(home, 'Applications/Mkd.app'))
    : platform === 'win32'
      ? [path.join(project, 'release/win-unpacked/Mkd.exe')]
      : [path.join(project, 'release/linux-unpacked/mkd')];
  const application = override ? path.resolve(override) : candidates.find(exists);
  if (override && !exists(application)) throw new Error(`MKD_APP does not exist: ${application}`);
  if (application) {
    if (platform === 'darwin' && application.endsWith('.app')) {
      // Launch Services delivers open-file even when the app is already running.
      return { command: '/usr/bin/open', args: ['-a', application, ...(file ? [file] : [])], wait: true };
    }
    return { command: application, args: file ? ['--open-file', file] : [], wait: false };
  }
  if (!exists(path.join(project, 'dist/index.html'))) throw new Error('Build Mkd first: run npm run build or npm run pack in the Mkd project.');
  const runtime = platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron';
  const executable = path.join(project, 'node_modules/electron/dist', runtime);
  if (!exists(executable)) throw new Error('The Electron runtime is missing. Run npm start once, or build the app with npm run pack.');
  return { command: executable, args: [project, ...(file ? ['--open-file', file] : [])], wait: false };
}

async function main(args) {
  const parsed = parseArguments(args);
  if (parsed.help) return console.log(help);
  if (parsed.version) return console.log(require('../package.json').version);
  const plan = launchPlan(parsed.file);
  const environment = { ...process.env };
  // A terminal opened by an Electron-based editor may inherit this variable.
  delete environment.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => {
    const child = spawn(plan.command, plan.args, {
      detached: !plan.wait, stdio: 'ignore', env: environment, shell: false,
    });
    child.once('error', reject);
    if (plan.wait) child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Could not launch Mkd (exit ${code}).`)));
    else child.once('spawn', () => { child.unref(); resolve(); });
  });
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  console.error(`mkd: ${error.message}`);
  process.exitCode = 1;
});
module.exports = { parseArguments, launchPlan };
