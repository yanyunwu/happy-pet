const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const root = path.resolve('build/wechatgame'),
  read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8').replace(/^\uFEFF/, ''));
const settingsFile = fs
  .readdirSync(path.join(root, 'src'))
  .find((p) => /^settings(?:\.[^.]+)?\.json$/.test(p));
assert.ok(settingsFile, 'startup settings exist');
const settings = read('src/' + settingsFile),
  versions = settings.assets.bundleVers;
assert.ok(versions.main && versions.resources, 'main and resources carry cache versions');
const main = read(`assets/main/config.${versions.main}.json`),
  names = Object.keys(main.scenes);
assert.equal(main.name, 'main');
assert.ok(names.some((n) => n.endsWith('/loading.scene')));
assert.ok(names.some((n) => n.endsWith('/main.scene')));
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
assert.ok(
  game.includes("overrideSettings('launch', 'launchScene', 'loading')"),
  'launch uses the unique scene name',
);
assert.ok(game.includes('SCENE_NOT_REGISTERED'), 'scene presence is checked before launch');
for (const match of game.matchAll(/require\(['"]((?:\.\/|src\/)[^'"]+)['"]\)/g))
  assert.ok(fs.existsSync(path.resolve(root, match[1])), `boot dependency exists: ${match[1]}`);
const config = read('game.json'),
  resource = config.subpackages.find((p) => p.name === 'resources');
assert.ok(resource);
assert.ok(fs.existsSync(path.join(root, resource.root, 'game.js')), 'subpackage entry exists');
assert.equal(read(`${resource.root}config.${versions.resources}.json`).name, 'resources');
const result = {
  success: true,
  launch: 'loading',
  scenes: names,
  versions,
  checks: [
    'both scenes included',
    'versioned scene metadata',
    'all bootstrap script references exist',
    'resource subpackage entry exists',
    'scene lookup validated before run',
  ],
};
fs.writeFileSync('output/wechat-build-qa.json', JSON.stringify(result, null, 2));
console.log('PASS — versioned WeChat build, both scenes and all startup dependencies verified.');
