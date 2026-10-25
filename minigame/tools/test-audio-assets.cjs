const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifestFile = path.join(root, 'art/woodland-audio-manifest.json');
assert(fs.existsSync(manifestFile), 'The woodland soundscape manifest must exist');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const required = [
  'tap',
  'tile',
  'blocked',
  'match',
  'match-four',
  'match-pairs',
  'undo',
  'shovel',
  'hint',
  'shuffle',
  'popup-open',
  'popup-close',
  'reward',
  'stage',
  'win',
  'lose',
  'music-home',
  'music',
  'voice-start',
  'voice-next',
  'voice-win',
  'voice-lose',
];
assert.deepEqual(manifest.assets.map((asset) => asset.name).sort(), required.sort());
let totalBytes = 0;
for (const asset of manifest.assets) {
  const file = path.join(root, asset.file);
  assert(fs.existsSync(file), asset.file);
  assert(fs.existsSync(file + '.meta'), asset.file + '.meta');
  const decoded = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '22050', '-'],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(decoded.status, 0, decoded.stderr?.toString());
  let peak = 0,
    energy = 0;
  const count = decoded.stdout.length / 4;
  for (let i = 0; i < count; i++) {
    const sample = decoded.stdout.readFloatLE(i * 4);
    assert(Number.isFinite(sample));
    peak = Math.max(peak, Math.abs(sample));
    energy += sample * sample;
  }
  const duration = count / 22050,
    rms = Math.sqrt(energy / count);
  assert(peak <= 0.99 && peak > 0.05, `${asset.name}: clipped or silent peak ${peak}`);
  assert(rms > 0.005, `${asset.name}: inaudible audio`);
  if (asset.kind === 'music')
    assert(duration >= 30 && duration <= 60, `${asset.name}: loop length`);
  if (asset.kind === 'voice')
    assert(duration > 0.4 && duration < 6, `${asset.name}: spoken cue length`);
  totalBytes += fs.statSync(file).size;
}
assert(totalBytes < 1800000, `Audio download is too large: ${totalBytes}`);
console.log(
  `PASS — ${manifest.assets.length} woodland audio assets decode, contain sound, avoid clipping and total ${totalBytes} bytes.`,
);
