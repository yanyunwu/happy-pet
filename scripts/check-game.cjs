const { spawnSync } = require('node:child_process');
const compiler =
  process.env.COCOS_TSC ||
  'C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript/lib/tsc.js';
// The project can be opened with a newer TypeScript language service while
// Creator still bundles TypeScript 5. Keep that editor setting intact and use
// the deprecation version understood by the compiler performing this check.
const version = spawnSync(process.execPath, [compiler, '--version'], { encoding: 'utf8' });
const creatorCompatibility = /Version 5\./.test(version.stdout || '')
  ? ['--ignoreDeprecations', '5.0']
  : [];
const result = spawnSync(
  process.execPath,
  [compiler, '--noEmit', '--skipLibCheck', ...creatorCompatibility, '-p', 'minigame/tsconfig.json'],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
