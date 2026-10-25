// Package image_gen PNGs for the existing woodland UI; preserve their alpha and artwork.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const { root, imageMeta } = require('./lib/creator.cjs');
(async () => {
  for (const name of ['menu-support', 'menu-announcement']) {
    const source = path.join(root, 'art/source-woodland', name + '.png');
    const target = 'assets/resources/cartoon/ui/' + name + '.png';
    const bytes = await sharp(source).resize(256, 256, { fit: 'contain' }).png().toBuffer();
    fs.writeFileSync(path.join(root, target), bytes);
    imageMeta(target, 256, 256);
  }
  console.log('Packaged 2 woodland menu icons.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
