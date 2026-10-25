// Package image_gen artwork into game sprites; no illustration is synthesized here.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { root, imageMeta, write } = require('./lib/creator.cjs');
let sharp;
for (const location of ['sharp', process.env.SHARP_PATH,
    'C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'].filter(Boolean)) {
    try { sharp = require(location); break; } catch {}
}
if (!sharp) throw new Error('sharp is required to package the woodland artwork.');
const source = name => path.join(root, 'art/source-woodland', `${name}.png`);
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
function writeImage(file, bytes) {
    if (fs.existsSync(file) && fs.readFileSync(file).equals(bytes)) return;
    // Creator can memory-map a displayed texture on Windows. Replace the file
    // atomically instead of truncating a mapped PNG in place.
    const temporary = file + '.woodland-tmp';
    fs.writeFileSync(temporary, bytes);
    try { fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

// The generated atlases have generous gutters but unequal object widths. Identify
// connected silhouettes, then group by the requested grid; this avoids clipping
// ears and preserves multi-part icons such as menu/pause without foreign pixels.
async function splitAtlas(name, cols, rows) {
    const { data, info } = await sharp(source(name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info, labels = new Int32Array(w * h), queue = new Int32Array(w * h);
    const groups = Array.from({ length: cols * rows }, () => []);
    let serial = 0;
    for (let i = 0; i < w * h; i++) {
        if (labels[i] || data[i * 4 + 3] < 16) continue;
        const id = ++serial; let head = 0, tail = 1, left = w, right = 0, top = h, bottom = 0;
        labels[i] = id; queue[0] = i;
        while (head < tail) {
            const p = queue[head++], x = p % w, y = Math.floor(p / w);
            left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
            for (const next of [x ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y ? p - w : -1, y < h - 1 ? p + w : -1]) {
                if (next < 0 || labels[next] || data[next * 4 + 3] < 16) continue;
                labels[next] = id; queue[tail++] = next;
            }
        }
        if (tail < 1000) continue;
        const col = Math.min(cols - 1, Math.floor((left + right) / 2 / w * cols));
        const row = Math.min(rows - 1, Math.floor((top + bottom) / 2 / h * rows));
        groups[row * cols + col].push({ id, left, right, top, bottom });
    }
    return Promise.all(groups.map(async (group, index) => {
        assert(group.length, `${name} is missing grid cell ${index}`);
        const left = Math.max(0, Math.min(...group.map(b => b.left)) - 2);
        const top = Math.max(0, Math.min(...group.map(b => b.top)) - 2);
        const right = Math.min(w - 1, Math.max(...group.map(b => b.right)) + 2);
        const bottom = Math.min(h - 1, Math.max(...group.map(b => b.bottom)) + 2);
        const width = right - left + 1, height = bottom - top + 1, pixels = Buffer.alloc(width * height * 4);
        const ids = new Set(group.map(b => b.id));
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const p = (top + y) * w + left + x, dest = (y * width + x) * 4;
            if (!ids.has(labels[p])) continue;
            data.copy(pixels, dest, p * 4, p * 4 + 4);
        }
        return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    }));
}
async function sprite(buffer, file, width, height, border = 0, padding = 4, fit = 'contain') {
    const out = path.join(root, file);
    const encoded = await sharp(buffer).resize(width - padding * 2, height - padding * 2, { fit, background: transparent })
        .extend({ top: padding, bottom: padding, left: padding, right: padding, background: transparent })
        .png({ compressionLevel: 9 }).toBuffer();
    writeImage(out, encoded);
    // Deterministic existing UUIDs are retained when dimensions/borders change.
    const inset = Array.isArray(border) ? border : [border, border];
    imageMeta(file, width, height, inset[1]);
    if (inset[0] !== inset[1]) {
        const metaFile = out + '.meta', metadata = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        const frame = metadata.subMetas.f9941.userData;
        frame.borderLeft = frame.borderRight = inset[0];
        write(file + '.meta', metadata);
    }
}
async function main() {
    for (const name of ['logo', 'pets', 'icons', 'skins']) {
        const metadata = await sharp(source(name)).metadata(), stats = await sharp(source(name)).stats();
        assert(metadata.hasAlpha && stats.channels[3].min === 0, `${name} must have real transparency`);
    }
    for (const name of ['home', 'game']) {
        const file = `assets/resources/cartoon/${name}.jpg`;
        writeImage(path.join(root, file), await sharp(source(name)).resize(720, 1560, { fit: 'cover' }).jpeg({ quality: 91, mozjpeg: true }).toBuffer());
        imageMeta(file, 720, 1560);
    }
    await sprite(await sharp(source('logo')).trim().toBuffer(), 'assets/resources/cartoon/home-ui/woodland-logo.png', 720, 420, 0, 4);
    const pets = await splitAtlas('pets', 5, 3), icons = await splitAtlas('icons', 4, 4), skins = await splitAtlas('skins', 4, 4);
    for (let i = 0; i < 15; i++) {
        const file = `assets/resources/cartoon/pets/${i}.png`;
        await sprite(pets[i], file, 256, 256, 0, 10);
        writeImage(path.resolve(root, '../admin/public/pets', `${i}.png`), fs.readFileSync(path.join(root, file)));
    }
    for (const i of [1, 3, 4, 5, 6, 7, 9]) await sprite(icons[i], `assets/resources/cartoon/icons/${i}.png`, 256, 256, 0, 10);
    for (const [name, index] of [['coin', 10], ['signin', 11], ['backpack', 12]])
        await sprite(icons[index], `assets/resources/cartoon/home-ui/${name}.png`, 256, 256, 0, 10);
    for (const [name, index] of [['menu', 13], ['pause', 14], ['gear', 4]])
        await sprite(icons[index], `assets/resources/cartoon/ui/${name}.png`, 128, 128, 0, 6);
    for (const [name, index, width, height, border] of [
        ['button-blue', 0, 384, 176, [88, 76]], ['button-gold', 1, 384, 176, [88, 76]],
        ['panel', 2, 256, 256, 64], ['tile', 3, 128, 132, 24],
        ['tray', 4, 512, 176, 40], ['slot', 5, 128, 128, 26],
        ['side-badge', 6, 128, 128, 24], ['nav', 6, 256, 96, [56, 28]],
        ['round-dark', 6, 128, 128, 24], ['round-blue', 10, 128, 128, 24],
        ['badge-red', 12, 80, 52, 18], ['pill-dark', 13, 256, 96, 24],
        ['button-pink', 15, 384, 176, [88, 76]],
        ['button-amber', 14, 384, 176, [88, 76]],
    ]) await sprite(skins[index], `assets/resources/cartoon/ui/${name}.png`, width, height, border, 2, 'fill');
    writeImage(path.join(root, 'assets/startup/poster.jpg'), await sharp(source('loading')).resize(720, 1560, { fit: 'cover' }).jpeg({ quality: 91, mozjpeg: true }).toBuffer());
    imageMeta('assets/startup/poster.jpg', 720, 1560);
    writeImage(path.join(root, 'settings/loading-poster.jpg'), fs.readFileSync(path.join(root, 'assets/startup/poster.jpg')));
    await sprite(skins[13], 'assets/startup/track.png', 128, 48, 20, 2, 'fill');
    await sprite(skins[14], 'assets/startup/fill.png', 128, 48, 20, 2, 'fill');
    // This existing code-authored mask only controls availability shading.
    writeImage(path.join(root, 'assets/resources/cartoon/ui/covered.png'), await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="132"><rect x="3" y="3" width="122" height="116" rx="21" fill="#30271D" fill-opacity=".43"/></svg>')).png().toBuffer());
    const report = { theme: '森林木作', pets: 15, utilityIcons: 7, homeIcons: 3, skins: 14,
        sources: 'art/source-woodland', generator: 'built-in image_gen', adminPetIconsSynced: true };
    fs.writeFileSync(path.join(root, 'art/woodland-import.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('Packaged woodland backgrounds, logo, 15 pets, 7 utility icons, 14 UI skins and launch poster.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
