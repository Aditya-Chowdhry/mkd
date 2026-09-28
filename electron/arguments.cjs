const path = require('node:path');

function documentFromArguments(args, cwd = process.cwd()) {
  const index = args.indexOf('--open-file');
  if (index !== -1) return args[index + 1] ? path.resolve(cwd, args[index + 1]) : null;
  const file = args.find(arg => !arg.startsWith('-') && /\.(md|markdown|mdown|txt)$/i.test(arg));
  return file ? path.resolve(cwd, file) : null;
}
module.exports = { documentFromArguments };
