// Format/lint JavaScript-based EJS without changing Creator's raw engine include.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const mode = process.argv[2] || '--check';
assert(['--write', '--check', '--lint'].includes(mode), 'Expected --write, --check or --lint');
const template = 'minigame/build-templates/wechatgame/game.ejs';
const original = fs.readFileSync(path.join(root, template), 'utf8');
const includes = [];
const javascript = original
  .replace(/\r\n/g, '\n')
  .replace(/^[ \t]*(<%[-=][^\r\n]*%>)[ \t]*$/gm, (_, include) => {
    const index = includes.push(include) - 1;
    return `/* __CREATOR_EJS_INCLUDE_${index}__ */`;
  });
assert.equal(includes.length, 1, 'Review template parsing if the raw Creator includes change');
const packageName = mode === '--lint' ? 'oxlint' : 'oxfmt';
const requireFromRoot = createRequire(path.join(root, 'package.json'));
const packagePath = requireFromRoot.resolve(`${packageName}/package.json`);
const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const executable = path.resolve(path.dirname(packagePath), packageData.bin[packageName]);
let inputPath;
let args;
if (mode === '--lint') {
  // Keep the temporary source outside the ignored artifacts tree; use the
  // repository config explicitly, then remove this individual temporary file.
  inputPath = path.join(root, `.creator-template-lint-${process.pid}.js`);
  fs.writeFileSync(inputPath, javascript);
  args = ['--deny-warnings', '--config', path.join(root, '.oxlintrc.json'), inputPath];
} else {
  args = [
    '--stdin-filepath',
    template.replace(/\.ejs$/, '.js'),
    '--config',
    path.join(root, '.oxfmtrc.json'),
  ];
}
try {
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd: root,
    input: mode === '--lint' ? undefined : javascript,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || String(result.error));
    process.exitCode = result.status || 1;
  } else if (mode === '--lint') {
    process.stdout.write(result.stdout);
  } else {
    const formatted = result.stdout.replace(
      /\/\* __CREATOR_EJS_INCLUDE_(\d+)__ \*\//g,
      (_, i) => includes[Number(i)],
    );
    const beforeTags = original.match(/<%[\s\S]*?%>/g);
    const afterTags = formatted.match(/<%[\s\S]*?%>/g);
    assert.deepEqual(afterTags, beforeTags, 'Creator template expressions must remain exact');
    if (mode === '--write') fs.writeFileSync(path.join(root, template), formatted);
    else if (formatted !== original) {
      console.error(`${template} needs oxfmt formatting`);
      process.exitCode = 1;
    }
    if (!process.exitCode)
      console.log(
        `${mode === '--write' ? 'Formatted' : 'Checked'} Creator JavaScript template with oxfmt.`,
      );
  }
} finally {
  if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
}
