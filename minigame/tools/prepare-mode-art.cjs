// Import original generated home icons, preserving alpha; retain the originals.
const fs = require('node:fs'), path = require('node:path');
const { root, imageMeta, folderMeta, write, uuid } = require('./lib/creator.cjs');
const sharp = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
(async () => {
  const manifest = require('../art/home-v3-manifest.json');
  fs.mkdirSync(path.join(root, 'art/source-v3'), { recursive: true });
  folderMeta('assets/resources/cartoon/home-ui');
  for (const asset of manifest.assets) {
    fs.copyFileSync(asset.source, path.join(root, `art/source-v3/${asset.name}.png`));
    await sharp(asset.source).resize(256, 256).png().toFile(path.join(root, asset.output));
    imageMeta(asset.output, 256, 256);
  }
  const file = 'assets/scripts/core/Profile.ts';
  if (!fs.existsSync(path.join(root, file + '.meta'))) write(file + '.meta', { ver: '4.0.24', importer: 'typescript', imported: false, uuid: uuid(file), files: [], subMetas: {}, userData: {} });
  console.log('Imported three original home icons and profile script metadata.');
})();
