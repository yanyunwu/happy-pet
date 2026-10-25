// Original deterministic woodland music/foley and the selected online neural voice.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { root, uuid, write } = require('./lib/creator.cjs');
const rate = 22050;
const work = path.join(root, 'output/audio-source');
const output = path.join(root, 'assets/resources/audio');
const voicesOnly = process.argv.includes('--voices-only');
const voices = JSON.parse(fs.readFileSync(path.join(root, 'art/woodland-voices.json'), 'utf8'));
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(output, { recursive: true });
const assets = voicesOnly
  ? JSON.parse(
      fs.readFileSync(path.join(root, 'art/woodland-audio-manifest.json'), 'utf8'),
    ).assets.filter((asset) => asset.kind !== 'voice')
  : [];
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
function random(seed) {
  let n = seed >>> 0;
  return () => {
    n += 0x6d2b79f5;
    let x = Math.imul(n ^ (n >>> 15), 1 | n);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function tone(data, start, frequency, length, gain, type = 'marimba', seed = 1, loop = false) {
  const rnd = random(seed),
    count = Math.ceil(length * rate),
    offset = Math.round(start * rate);
  const delay = Math.max(2, Math.round(rate / Math.max(40, frequency))),
    string = new Float32Array(delay);
  for (let i = 0; i < delay; i++) string[i] = (rnd() * 2 - 1) * Math.sin((Math.PI * i) / delay);
  let low = 0;
  for (let i = 0; i < count; i++) {
    let index = offset + i;
    if (loop) index = ((index % data.length) + data.length) % data.length;
    else if (index < 0 || index >= data.length) continue;
    const t = i / rate,
      p = 2 * Math.PI * frequency * t;
    const attack = Math.min(1, t / (type === 'bass' ? 0.018 : 0.004));
    const release = Math.max(0, Math.min(1, (length - t) / 0.035));
    const decay = Math.exp(-t / (length * (type === 'bass' ? 0.5 : 0.32)));
    const noise = rnd() * 2 - 1;
    low = low * 0.84 + noise * 0.16;
    let wave;
    if (type === 'nylon') {
      const k = i % delay;
      wave = string[k] * 1.6;
      string[k] = (string[k] + string[(k + 1) % delay]) * 0.496;
    } else if (type === 'wood') {
      wave =
        Math.sin(p) * 0.72 +
        Math.sin(p * 2.17) * 0.3 * Math.exp(-t * 35) +
        Math.sin(p * 4.63) * 0.18 * Math.exp(-t * 65) +
        (noise - low) * 0.13 * Math.exp(-t * 95);
    } else if (type === 'air') {
      wave = low * (0.6 + 0.4 * Math.sin((Math.PI * t) / length));
    } else if (type === 'bass') {
      wave = Math.sin(p) + 0.18 * Math.sin(2 * p);
    } else if (type === 'kalimba') {
      wave =
        Math.sin(p + 0.7 * Math.exp(-t * 20) * Math.sin(p * 3)) +
        0.19 * Math.sin(p * 2.76) * Math.exp(-t * 10);
    } else {
      wave =
        Math.sin(p) +
        0.28 * Math.sin(p * 3.98) * Math.exp(-t * 16) +
        0.09 * Math.sin(p * 6.1) * Math.exp(-t * 28);
    }
    data[index] += wave * attack * decay * release * gain;
  }
}
function room(data, loop = false) {
  const dry = data.slice();
  for (const [seconds, gain] of [
    [0.043, 0.12],
    [0.079, 0.075],
    [0.127, 0.045],
  ]) {
    const shift = Math.round(seconds * rate);
    for (let i = 0; i < data.length; i++)
      if (loop || i >= shift) data[i] += dry[(i - shift + dry.length) % dry.length] * gain;
  }
}
function saveWave(name, data) {
  let peak = 0,
    energy = 0;
  for (const value of data) peak = Math.max(peak, Math.abs(value));
  const gain = peak ? 0.74 / peak : 1;
  const buffer = Buffer.alloc(44 + data.length * 2);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) {
    const value = Math.max(-0.9, Math.min(0.9, data[i] * gain));
    energy += value * value;
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  const file = path.join(work, name + '.wav');
  fs.writeFileSync(file, buffer);
  return { file, duration: data.length / rate, rms: Math.sqrt(energy / data.length), peak: 0.74 };
}
function encode(name, file, kind, details = {}) {
  const target = path.join(output, name + '.mp3'),
    temporary = path.join(work, name + '.mp3');
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', file];
  if (kind === 'voice') {
    // Gentle compression keeps the short neural cues from being limited by their peaks alone.
    const compression = voices.normalization.compression;
    args.push(
      '-af',
      'silenceremove=start_periods=1:start_duration=0.02:start_threshold=-55dB,areverse,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-55dB,areverse,highpass=f=95,lowpass=f=7000,' +
        `acompressor=threshold=${compression.threshold}:ratio=${compression.ratio}:attack=${compression.attackMs}:release=${compression.releaseMs},apad=pad_dur=0.08,` +
        `loudnorm=I=${voices.normalization.integratedLufs}:TP=${voices.normalization.truePeakDbtp}:LRA=${voices.normalization.loudnessRangeLu}`,
    );
  }
  args.push(
    '-ac',
    '1',
    '-ar',
    String(rate),
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '64k',
    '-write_xing',
    '1',
    '-id3v2_version',
    '3',
    temporary,
  );
  const encoded = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (encoded.status !== 0) throw new Error(encoded.stderr || 'ffmpeg encoding failed');
  fs.renameSync(temporary, target);
  const relative = 'assets/resources/audio/' + name + '.mp3';
  if (!fs.existsSync(target + '.meta'))
    write(relative + '.meta', {
      ver: '1.0.0',
      importer: 'audio-clip',
      imported: false,
      uuid: uuid(relative),
      files: [],
      subMetas: {},
      userData: { downloadMode: 0 },
    });
  assets.push({
    name,
    kind,
    file: relative,
    sampleRate: rate,
    ...details,
    ...(kind === 'voice'
      ? { sha256: createHash('sha256').update(fs.readFileSync(target)).digest('hex') }
      : {}),
  });
}
function effect(name, seconds, description, render) {
  if (voicesOnly) return;
  const data = new Float32Array(Math.round(seconds * rate));
  let seed = 100 + assets.length * 67;
  const hit = (at, frequency, length, gain, type) =>
    tone(data, at, frequency, length, gain, type, seed++);
  render(hit);
  room(data);
  const source = saveWave(name, data);
  encode(name, source.file, 'effect', { duration: source.duration, description });
}
effect('tap', 0.14, '轻敲原木按钮', (h) => h(0, 470, 0.12, 0.7, 'wood'));
effect('tile', 0.18, '拾起木雕牌片', (h) => {
  h(0, 330, 0.14, 0.7, 'wood');
  h(0.018, 720, 0.08, 0.15, 'wood');
});
effect('blocked', 0.22, '被覆盖木牌的柔和闷响', (h) => h(0, 175, 0.19, 0.55, 'wood'));
effect('match', 0.64, '三颗木琴音与轻木扣', (h) => {
  h(0, 360, 0.09, 0.18, 'wood');
  [74, 78, 81].forEach((n, i) => h(i * 0.065, hz(n), 0.43, 0.3, 'marimba'));
});
effect('match-four', 0.75, '四颗拇指琴音', (h) =>
  [69, 74, 78, 81].forEach((n, i) => h(i * 0.065, hz(n), 0.5, 0.3, 'kalimba')),
);
effect('match-pairs', 0.68, '两组配对木琴音', (h) =>
  [74, 78, 76, 81].forEach((n, i) => h([0, 0.055, 0.2, 0.255][i], hz(n), 0.35, 0.3, 'marimba')),
);
effect('undo', 0.36, '木片轻轻滑回', (h) => {
  h(0, 450, 0.24, 0.12, 'air');
  h(0.08, 310, 0.18, 0.45, 'wood');
  h(0.13, 230, 0.15, 0.22, 'wood');
});
effect('shovel', 0.5, '木铲扫过与牌片落位', (h) => {
  h(0, 700, 0.32, 0.28, 'air');
  h(0.23, 240, 0.17, 0.4, 'wood');
});
effect('hint', 0.72, '轻亮的拇指琴提示', (h) => {
  h(0, hz(81), 0.55, 0.3, 'kalimba');
  h(0.12, hz(86), 0.5, 0.17, 'kalimba');
});
effect('shuffle', 1.05, '木片转动与树叶沙沙', (h) => {
  for (let i = 0; i < 6; i++) {
    h(i * 0.115, 500, 0.17, 0.1, 'air');
    h(i * 0.115 + 0.025, 240 + i * 27, 0.09, 0.18, 'wood');
  }
  h(0.73, hz(74), 0.27, 0.18, 'marimba');
});
effect('popup-open', 0.24, '木盒打开的轻响', (h) => {
  h(0, 430, 0.11, 0.35, 'wood');
  h(0.015, 900, 0.18, 0.1, 'air');
});
effect('popup-close', 0.21, '木盒轻合', (h) => {
  h(0, 650, 0.12, 0.09, 'air');
  h(0.055, 260, 0.13, 0.37, 'wood');
});
effect('reward', 0.95, '木质金币收纳的明亮和弦', (h) =>
  [74, 81, 86].forEach((n, i) => h(i * 0.09, hz(n), 0.65, 0.28, 'kalimba')),
);
effect('stage', 1.15, '下一关的简短木琴应答', (h) => {
  [62, 66, 69].forEach((n) => h(0, hz(n), 0.7, 0.15, 'nylon'));
  h(0.2, hz(74), 0.7, 0.26, 'marimba');
  h(0.4, hz(81), 0.65, 0.22, 'marimba');
});
effect('win', 1.9, '温暖木琴与拨弦庆祝', (h) => {
  [74, 78, 81, 86].forEach((n, i) => h(i * 0.11, hz(n), 1.15, 0.28, 'marimba'));
  [62, 66, 69].forEach((n) => h(0.32, hz(n), 1.45, 0.18, 'nylon'));
  h(0.2, 600, 1.2, 0.07, 'air');
});
effect('lose', 1.25, '柔和下行拨弦，鼓励再试', (h) =>
  [74, 71, 69].forEach((n, i) => h(i * 0.16, hz(n), 0.83, 0.27, 'nylon')),
);

const phrases = [
  [
    [0, 74],
    [1, 78],
    [1.75, 81],
    [3, 78],
  ],
  [
    [0, 76],
    [1.5, 74],
    [2.5, 69],
  ],
  [
    [0, 71],
    [1, 74],
    [2, 78],
    [3.25, 76],
  ],
  [
    [0, 74],
    [2, 71],
    [3, 69],
  ],
  [
    [0, 67],
    [1, 71],
    [2, 74],
    [3, 78],
  ],
  [
    [0, 76],
    [1, 74],
    [2.5, 71],
  ],
  [
    [0, 69],
    [1, 73],
    [2, 76],
    [3, 81],
  ],
  [
    [0, 78],
    [1.5, 76],
    [3, 73],
  ],
];
function music(name, bpm, gameplay) {
  if (voicesOnly) return;
  const beat = 60 / bpm,
    duration = beat * 64,
    data = new Float32Array(Math.round(duration * rate));
  const roots = [62, 62, 59, 59, 55, 55, 57, 57];
  let seed = gameplay ? 620 : 310;
  const add = (at, midi, length, gain, type) =>
    tone(data, at, hz(midi), length, gain, type, seed++, true);
  for (let bar = 0; bar < 16; bar++) {
    const start = bar * 4 * beat,
      rootNote = roots[bar % 8],
      third = bar % 8 === 2 || bar % 8 === 3 ? 3 : 4;
    for (const [offset, note] of phrases[bar % 8]) {
      add(
        start + offset * beat + 0.012,
        note,
        beat * 1.45,
        gameplay ? 0.18 : 0.16,
        gameplay ? 'kalimba' : 'marimba',
      );
      if (bar >= 8 && offset === 0)
        add(start + 0.55 * beat, note + 12, beat * 0.65, 0.035, 'kalimba');
    }
    [0, 7, third, 12].forEach((interval, i) =>
      add(start + i * beat, rootNote + interval, beat * 1.45, 0.065, 'nylon'),
    );
    add(start, rootNote - 12, beat * 1.8, 0.09, 'bass');
    add(start + 2.5 * beat, rootNote - 5, beat * 1.15, 0.045, 'bass');
    if (gameplay) {
      for (let i = 0; i < 8; i++)
        tone(data, start + (i * beat) / 2, 600, 0.09, i % 2 ? 0.018 : 0.025, 'air', seed++, true);
      for (const at of [1, 3])
        tone(data, start + at * beat, 190, 0.105, 0.025, 'wood', seed++, true);
    } else tone(data, start + 2 * beat, 310, 0.13, 0.018, 'wood', seed++, true);
  }
  room(data, true);
  const source = saveWave(name, data);
  encode(name, source.file, 'music', {
    duration: source.duration,
    bpm,
    loop: true,
    description: gameplay
      ? '萌宠寻路：拇指琴、拨弦、木拍与叶声'
      : '林间小憩：木琴、柔和拨弦与暖低音',
  });
}
music('music-home', 88, false);
music('music', 100, true);
const speech = spawnSync(
  'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
  ['-NoProfile', '-File', path.join(__dirname, 'generate-voices.ps1'), '-OutputDirectory', work],
  { encoding: 'utf8' },
);
if (speech.status !== 0)
  throw new Error(speech.stderr || speech.stdout || 'Neural speech synthesis failed');
const { sourceHashes, ...voiceEngine } = JSON.parse(
  fs.readFileSync(path.join(work, 'voice-engine.json'), 'utf8'),
);
for (const clip of voices.clips)
  encode(clip.name, path.join(work, clip.name + '.source.mp3'), 'voice', {
    text: clip.text,
    ...voiceEngine,
    sourceSha256: sourceHashes[clip.name],
    normalization: voices.normalization,
  });
write('art/woodland-audio-manifest.json', {
  version: 2,
  theme: '森林木作 · 木琴小径',
  method: 'Original deterministic DSP composition and foley; Microsoft Edge online neural speech',
  source: 'tools/generate-audio.cjs',
  speechSource: 'tools/generate-voices.py',
  speechWrapper: 'tools/generate-voices.ps1',
  assets,
});
console.log(
  voicesOnly
    ? 'Replaced four neural Chinese voice cues; preserved music, effects and existing asset metadata.'
    : 'Generated ' +
        assets.length +
        ' woodland audio assets, including two original music loops and four neural Chinese voice cues.',
);
