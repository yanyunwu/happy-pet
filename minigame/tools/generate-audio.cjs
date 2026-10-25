// Original synthesized, deterministic music and sound effects. No sampled audio.
const fs = require('node:fs');
const path = require('node:path');
const rate = 22050;
const out = path.resolve(__dirname, '../assets/resources/audio'); fs.mkdirSync(out, { recursive: true });
function render(name, duration, notes) {
  const data = new Float32Array(Math.ceil(duration * rate));
  for (const [start, frequency, length, gain] of notes) {
    for (let i = 0; i < length * rate && Math.round(start * rate) + i < data.length; i++) {
      const t = i / rate, env = Math.min(1, t / .012) * Math.exp(-t / (length * .26)) * Math.min(1, (length - t) / .05);
      const wave = Math.sin(2 * Math.PI * frequency * t) + .25 * Math.sin(2 * Math.PI * frequency * 2 * t) + .08 * Math.sin(2 * Math.PI * frequency * 3 * t);
      data[Math.round(start * rate) + i] += wave * env * gain;
    }
  }
  const buffer = Buffer.alloc(44 + data.length * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(data.length * 2, 40);
  data.forEach((sample, i) => buffer.writeInt16LE(Math.round(Math.tanh(sample) * 23000), 44 + i * 2));
  fs.writeFileSync(path.join(out, name + '.wav'), buffer);
}
render('tap', .13, [[0, 880, .12, .5]]);
render('match', .68, [[0, 784, .38, .4], [.09, 988, .4, .4], [.18, 1175, .48, .4]]);
render('win', 1.9, [[0, 523, .5, .4], [.18, 659, .5, .4], [.36, 784, .5, .4], [.56, 1047, 1.2, .45], [.56, 659, 1.2, .15]]);
render('lose', .9, [[0, 392, .45, .35], [.22, 330, .6, .35]]);
const melody = [72, 76, 79, 76, 74, 72, 69, 67, 69, 72, 76, 74, 72, 69, 67, 64, 65, 69, 72, 76, 74, 72, 69, 65, 67, 71, 74, 79, 76, 74, 71, 67];
const hz = midi => 440 * 2 ** ((midi - 69) / 12), notes = [];
melody.forEach((midi, i) => notes.push([i * .5, hz(midi), 1.15, .2]));
[48, 45, 41, 43].forEach((root, bar) => [0, 4, 7, 12].forEach((step, i) => notes.push([bar * 4 + i, hz(root + step), 2, .12])));
render('music', 16, notes);
console.log('Generated five original audio assets.');
