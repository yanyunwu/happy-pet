// Exercise the music controller with asynchronous/blocked audio and platform interruptions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');

function harness({ autoplay = true, floatVolume = false } = {}) {
  const listeners = new Map();
  const state = { INIT: 0, PLAYING: 1, PAUSED: 2, STOPPED: 3, INTERRUPTED: 4 };
  class AudioSource {
    static AudioState = state;
    static EventType = { STARTED: 'started', ENDED: 'ended' };
    isValid = true;
    gain = 0;
    volumeWrites = 0;
    set volume(value) {
      this.volumeWrites++;
      this.gain = floatVolume ? Math.fround(value) : value;
    }
    get volume() {
      return this.gain;
    }
    state = state.INIT;
    playCalls = 0;
    autoStart = autoplay;
    stallNextPlay = false;
    nativeStalled = false;
    currentTime = 0;
    set clip(value) {
      this.asset = value;
      this.state = state.INIT;
      this.currentTime = 0;
      this.nativeStalled = false;
    }
    get clip() {
      return this.asset;
    }
    get playing() {
      return this.state === state.PLAYING;
    }
    play() {
      this.playCalls++;
      if (this.stallNextPlay) {
        this.nativeStalled = true;
        this.stallNextPlay = false;
      }
      if (this.autoStart && !this.nativeStalled) this.start();
    }
    start() {
      this.state = state.PLAYING;
      this.node.emit(AudioSource.EventType.STARTED);
    }
    stop() {
      this.state = state.STOPPED;
      this.currentTime = 0;
    }
    pause() {
      this.state = state.PAUSED;
    }
  }
  class Node {
    callbacks = new Map();
    addComponent(Type) {
      const source = new Type();
      source.node = this;
      return source;
    }
    on(name, fn, target) {
      this.callbacks.set(name, () => fn.call(target));
    }
    emit(name) {
      this.callbacks.get(name)?.();
    }
  }
  const file = path.resolve(__dirname, '../assets/scripts/ui/WoodlandAudio.ts');
  const mod = new Module(file);
  mod.require = (name) => {
    assert.equal(name, 'cc');
    return {
      _decorator: { ccclass: () => (Type) => Type },
      AudioSource,
      AudioClip: class {},
      Node,
      Component: class {
        isValid = true;
        node = new Node();
      },
      Game: { EVENT_HIDE: 'hide', EVENT_SHOW: 'show' },
      game: {
        on(name, fn, target) {
          listeners.set(name, () => fn.call(target));
        },
        off(name) {
          listeners.delete(name);
        },
      },
      resources: {
        load(name, _type, callback) {
          callback(null, { name });
        },
      },
    };
  };
  mod._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        experimentalDecorators: true,
      },
    }).outputText,
    file,
  );
  const audio = new mod.exports.WoodlandAudio();
  let enabled = true;
  audio.configure(() => enabled);
  const advance = (seconds) => {
    for (let elapsed = 0; elapsed < seconds;) {
      const dt = Math.min(0.02, seconds - elapsed);
      audio.update(dt);
      elapsed += dt;
    }
  };
  advance(2);
  return {
    audio,
    advance,
    state,
    emit: (event) => listeners.get(event)?.(),
    active: () => audio.musicSlots.find((slot) => slot.target === 1),
    mute() {
      enabled = false;
      audio.syncEnabled();
    },
    unmute() {
      enabled = true;
      audio.syncEnabled();
    },
  };
}

test('music resumes after an unexpected pause without changing the track or playback position', () => {
  const h = harness();
  h.audio.setMode('game');
  h.advance(2);
  const slot = h.active();
  slot.source.currentTime = 17;
  slot.source.pause();
  h.advance(1.2);
  assert.equal(slot.source.playing, true, 'background music must recover without a click');
  assert.equal(h.active(), slot);
  assert.equal(slot.source.currentTime, 17);
  assert.ok(slot.source.volume > 0.18);
});

test('a stopped loop recovers even though its selected name and target are unchanged', () => {
  const h = harness();
  const slot = h.active();
  slot.source.stop();
  h.audio.play('tile');
  h.advance(1.2);
  assert.equal(slot.source.playing, true);
  assert.equal(h.active(), slot);
  assert.equal(slot.name, 'music-home');
});

test('healthy loops and pending initial autoplay are not repeatedly restarted', () => {
  for (const autoplay of [true, false]) {
    const h = harness({ autoplay });
    const slot = h.active();
    const before = slot.source.playCalls;
    for (let i = 0; i < 30; i++) {
      h.audio.play('tile');
      h.advance(0.2);
    }
    assert.equal(
      slot.source.playCalls,
      before,
      'initial autoplay/loading must remain a single request',
    );
    assert.equal(slot.source.playing, autoplay);
    if (!autoplay) {
      slot.source.start();
      h.advance(0.5);
      assert.equal(slot.source.playing, true);
    }
  }
});

test('settled and inactive music channels do not keep writing native volume every frame', () => {
  const h = harness();
  h.advance(4);
  const before = h.audio.musicSlots.map((slot) => slot.source.volumeWrites);
  h.advance(60);
  assert.deepEqual(
    h.audio.musicSlots.map((slot, index) => slot.source.volumeWrites - before[index]),
    [0, 0],
    'steady playback should not send thousands of redundant native volume changes',
  );
  assert.equal(h.active().source.volume, 0.28);
});

test('music fades and speech ducking settle at their target volume', () => {
  const h = harness();
  h.audio.setMode('game');
  h.advance(0.1);
  assert.ok(h.active().source.volume > 0 && h.active().source.volume < 0.22);
  h.advance(2);
  assert.equal(h.active().source.volume, 0.22);
  h.audio.play('tile');
  h.audio.speak('start');
  h.advance(2);
  assert.equal(h.active().source.volume, 0.22 * 0.3);
  h.audio.voice.node.emit('ended');
  h.advance(2);
  assert.equal(h.active().source.volume, 0.22);
  assert.equal(h.audio.musicSlots.filter((slot) => slot.source.playing).length, 1);
});

test('native volume readback rounding does not keep a completed fade active', () => {
  const h = harness({ floatVolume: true });
  h.advance(4);
  const source = h.active().source;
  const before = source.volumeWrites;
  h.advance(60);
  assert.equal(source.volumeWrites, before, 'allow native float rounding after the fade settles');
  assert.ok(Math.abs(source.volume - 0.28) < 0.0001);
});

test('recovery requests are bounded while the audio backend is slow to resume', () => {
  const h = harness();
  const slot = h.active();
  slot.source.autoStart = false;
  slot.source.pause();
  const before = slot.source.playCalls;
  for (let i = 0; i < 250; i++) {
    h.audio.play('tile');
    h.advance(0.01);
  }
  assert.equal(
    slot.source.playCalls - before,
    1,
    'many frames and taps must not flood the audio queue',
  );
  slot.source.start();
  h.advance(3);
  assert.equal(
    slot.source.playCalls - before,
    1,
    'a successful resume must stop recovery attempts',
  );
});

test('mute/background remain silent and foreground restarts only the current music', () => {
  const h = harness();
  h.audio.setMode('game');
  h.advance(1);
  h.emit('hide');
  h.advance(3);
  assert.ok(h.audio.musicSlots.every((slot) => !slot.source.playing));
  h.mute();
  h.emit('show');
  h.advance(3);
  assert.ok(h.audio.musicSlots.every((slot) => !slot.source.playing));
  h.unmute();
  h.advance(2);
  assert.equal(h.active().name, 'music');
  assert.equal(h.active().source.playing, true);
  assert.equal(h.audio.musicSlots.filter((slot) => slot.source.playing).length, 1);
  h.audio.onDestroy();
  assert.ok(h.audio.musicSlots.every((slot) => !slot.source.playing));
  h.emit('show');
  assert.ok(h.audio.musicSlots.every((slot) => !slot.source.playing));
});

test('active platform interruptions are respected until the audio backend becomes resumable', () => {
  const h = harness();
  const slot = h.active();
  const before = slot.source.playCalls;
  slot.source.state = h.state.INTERRUPTED;
  h.advance(4);
  assert.equal(slot.source.playCalls, before);
  slot.source.state = h.state.PAUSED;
  h.advance(1.2);
  assert.equal(slot.source.playing, true);
});

test('a native resume that never acknowledges playback is recovered without losing its position', () => {
  const h = harness();
  const slot = h.active();
  const calls = slot.source.playCalls;
  slot.source.currentTime = 17;
  slot.source.pause();
  slot.source.stallNextPlay = true;
  h.advance(2);
  assert.equal(slot.source.playing, false);
  assert.equal(slot.source.playCalls, calls + 1);
  h.advance(5);
  assert.equal(
    h.active().source.playing,
    true,
    'replace a wedged native queue after its recovery deadline',
  );
  assert.equal(h.active().source.currentTime, 17);
  assert.equal(slot.source.playCalls, calls + 2);
});

test('a long audio focus loss does not continually recreate native players', () => {
  const h = harness();
  const slot = h.active();
  const calls = slot.source.playCalls;
  slot.source.autoStart = false;
  slot.source.pause();
  h.advance(30);
  assert.equal(
    slot.source.playCalls,
    calls + 2,
    'one resume and one fallback are enough until playback returns',
  );
  slot.source.start();
  slot.source.autoStart = true;
  h.advance(1);
  slot.source.pause();
  h.advance(2);
  assert.equal(slot.source.playing, true, 'a later interruption can still recover');
});
