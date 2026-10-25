const path = require('node:path');
const sharp = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const root = path.resolve(__dirname, '../output/qa-tools');
(async () => {
  const files = ['06-classic-second-stage.png', '07-shoveled-row.png', '03-fifteen-pets.png'];
  const images = await Promise.all(files.map(f => sharp(path.join(root, f)).resize(360, 780).toBuffer()));
  await sharp({ create: { width: 1112, height: 796, channels: 3, background: '#d7eef3' } })
    .composite(images.map((input, i) => ({ input, left: 8 + i * 368, top: 8 }))).jpeg({ quality: 92 }).toFile(path.join(root, 'design-review.jpg'));
  console.log('Saved output/qa-tools/design-review.jpg');
})();
