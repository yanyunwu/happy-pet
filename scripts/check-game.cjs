const { spawnSync } = require('node:child_process');
const compiler =
  process.env.COCOS_TSC ||
  'C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript/lib/tsc.js';
const result = spawnSync(
  process.execPath,
  [compiler, '--noEmit', '--skipLibCheck', '-p', 'minigame/tsconfig.json'],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
