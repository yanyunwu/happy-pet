// Mechanical sizing and copying only. New illustrations come from built-in image_gen.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { root } = require('./lib/creator.cjs');
const manifest = require('../art/pets-zodiac-manifest.json');
let sharp;
for (const location of ['sharp', process.env.SHARP_PATH,
    'C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'].filter(Boolean)) {
    try { sharp = require(location); break; } catch {}
}
if (!sharp) throw new Error('sharp is required to prepare game sprites.');

async function main() {
    assert.equal(manifest.assets.length, 15);
    const labels = manifest.assets.map(a => a.label);
    for (const [file, constant] of [
        ['assets/scripts/core/MatchGame.ts', 'KIND_NAMES'],
        ['../admin/src/game-api.ts', 'petNames'],
    ]) {
        const text = fs.readFileSync(path.resolve(root, file), 'utf8');
        const declaration = text.match(new RegExp(`export const ${constant} = \\[([\\s\\S]*?)\\];`));
        assert(declaration, `Missing ${constant}`);
        assert.deepEqual(Array.from(declaration[1].matchAll(/'([^']+)'/g), m => m[1]), labels,
            `${constant} must use the same order as the art manifest.`);
    }
    // Validate every source before replacing runtime assets.
    for (const [index, asset] of manifest.assets.entries()) {
        assert.equal(asset.index, index);
        const source = path.join(root, asset.source);
        const metadata = await sharp(source).metadata();
        const stats = await sharp(source).stats();
        assert(metadata.hasAlpha && stats.channels[3].min === 0 && stats.channels[3].max > 0,
            `${asset.name} must have a genuine transparent background.`);
        if (asset.prepared) assert(metadata.width === 256 && metadata.height === 256);
        assert(fs.existsSync(path.join(root, asset.output + '.meta')), 'Preserve existing Creator UUIDs.');
    }
    for (const asset of manifest.assets) {
        const source = path.join(root, asset.source), output = path.join(root, asset.output);
        if (asset.prepared) fs.copyFileSync(source, output);
        else await sharp(source).trim({ threshold: 12 })
            .resize(240, 240, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .extend({ top: 8, bottom: 8, left: 8, right: 8, background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png({ compressionLevel: 9 }).toFile(output);
        fs.copyFileSync(output, path.resolve(root, '../admin/public/pets', `${asset.index}.png`));
    }
    console.log('Prepared 15 zodiac + cat/panda/lion sprites for minigame and admin; Creator UUIDs preserved.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
