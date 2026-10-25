const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifestFile = path.join(root, 'art/woodland-audio-manifest.json');
assert(fs.existsSync(manifestFile), 'The woodland soundscape manifest must exist');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const voiceSpec = JSON.parse(fs.readFileSync(path.join(root, 'art/woodland-voices.json'), 'utf8'));
assert.equal(voiceSpec.voice, 'zh-CN-XiaoyiNeural', 'Use the selected audition A voice');
assert.equal(voiceSpec.rate, '+2%');
assert.equal(voiceSpec.pitch, '+0Hz');
assert.equal(voiceSpec.provider, 'Microsoft Edge online neural text-to-speech');
assert.equal(voiceSpec.tool, 'edge-tts');
assert.equal(voiceSpec.toolVersion, '7.3.1');
assert.deepEqual(voiceSpec.clips, [
  { name: 'voice-start', text: '准备好，出发啦！' },
  { name: 'voice-next', text: '继续加油！' },
  { name: 'voice-win', text: '真棒，闯关成功！' },
  { name: 'voice-lose', text: '慢慢来，再试一次吧。' },
]);
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
  if (asset.kind === 'voice') {
    assert(duration > 0.4 && duration < 6, `${asset.name}: spoken cue length`);
    for (const field of [
      'provider',
      'engine',
      'voice',
      'language',
      'tool',
      'toolVersion',
      'rate',
      'pitch',
      'volume',
    ])
      assert.equal(asset[field], voiceSpec[field], `${asset.name}: actual neural speech ${field}`);
    assert.equal(asset.text, voiceSpec.clips.find((clip) => clip.name === asset.name)?.text);
    assert.deepEqual(asset.normalization, voiceSpec.normalization);
    assert.equal(asset.sha256, createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
    const measured = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-i',
        file,
        '-af',
        'loudnorm=I=-19:TP=-3:LRA=7:print_format=json',
        '-f',
        'null',
        '-',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(measured.status, 0, measured.stderr);
    const loudnessJson = measured.stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
    assert(loudnessJson, `${asset.name}: loudness measurement is available`);
    const loudness = JSON.parse(loudnessJson[0]);
    const integrated = Number(loudness.input_i),
      truePeak = Number(loudness.input_tp);
    assert(
      Math.abs(integrated - voiceSpec.normalization.integratedLufs) <= 0.75,
      `${asset.name}: inconsistent loudness ${integrated} LUFS`,
    );
    assert(truePeak <= -2.5, `${asset.name}: insufficient encoded peak headroom ${truePeak} dBTP`);
    console.log(`${asset.name}: ${duration.toFixed(2)} s, ${integrated} LUFS, ${truePeak} dBTP`);
  }
  totalBytes += fs.statSync(file).size;
}
assert(totalBytes < 1800000, `Audio download is too large: ${totalBytes}`);
console.log(
  `PASS — ${manifest.assets.length} woodland audio assets decode, contain sound, avoid clipping and total ${totalBytes} bytes.`,
);
