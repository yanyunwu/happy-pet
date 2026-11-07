const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
const file = path.resolve(__dirname, '../assets/scripts/core/ToolPolicy.ts');
const mod = new Module(file);
mod._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  file,
);
const { toolAvailability } = mod.exports;
const policy = (entry, free, bag, bagUsed = false, shared = false, shareUses = 0) =>
  toolAvailability(entry, free, bag, bagUsed, shared, shareUses);
assert.deepEqual(policy('campaign', 2, 8), { uses: 3, source: 'free', canShare: false });
assert.deepEqual(policy('campaign', 0, 8), { uses: 1, source: 'bag', canShare: false });
assert.deepEqual(policy('campaign', 0, 8, true), { uses: 0, source: null, canShare: true });
assert.deepEqual(policy('campaign', 0, 0), { uses: 0, source: null, canShare: true });
assert.deepEqual(policy('standard', 0, 8), { uses: 0, source: null, canShare: true });
assert.deepEqual(policy('campaign', 0, 8, false, true, 1), {
  uses: 1,
  source: 'share',
  canShare: false,
});
assert.deepEqual(policy('campaign', 0, 8, false, true, 0), {
  uses: 0,
  source: null,
  canShare: false,
});
console.log('PASS — per-tool free, one inventory, and share stages');
