// Exercise the music controller with asynchronous/blocked audio and platform interruptions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');

function harness({ autoplay = true, floatVolume = false, stoppedStopStalls = false } = {}) {
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
    // Track channel-level attempts and platform availability across replacement
    // components, while each component still owns an independent native queue.
    get playCalls() {
      return this.node.playCalls || 0;
    }
    set playCalls(value) {
      this.node.playCalls = value;
    }
    get autoStart() {
      return this.node.autoStart ?? autoplay;
    }
    set autoStart(value) {
      this.node.autoStart = value;
    }
    stallNextPlay = false;
    nativeStalled = false;
    currentTime = 0;
    asset = null;
    set clip(value) {
      // Creator does not recreate its native player for an identical clip.
      if (value === this.asset) return;
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
      this.node.emit(AudioSource.EventType.STARTED, this);
    }
    stop() {
      // Some native contexts do not acknowledge stop when already stopped;
      // Creator waits for that callback before running the queued play.
      if (stoppedStopStalls && this.state === state.STOPPED) this.nativeStalled = true;
      this.state = state.STOPPED;
      this.currentTime = 0;
    }
    pause() {
      this.state = state.PAUSED;
    }
    destroy() {
      this.clip = null;
      this.isValid = false;
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
      this.callbacks.set(name, (...args) => fn.call(target, ...args));
    }
    emit(name, ...args) {
      this.callbacks.get(name)?.(...args);
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

test('home music remains audible until the game loop actually starts', () => {
  const h = harness();
  const home = h.active();
  const incoming = h.audio.musicSlots.find((slot) => slot !== home);
  incoming.source.autoStart = false;
  h.audio.play('tap');
  h.audio.setMode('game');
  h.advance(10);
  assert.equal(home.source.playing, true, 'a slow game player must not leave silence');
  assert.ok(home.source.volume > 0.18);
  assert.equal(incoming.source.playCalls, 1, 'allow the native eight-second load window');
  incoming.source.start();
  h.advance(2);
  assert.equal(incoming.source.volume, 0.22);
  assert.equal(home.source.playing, false);
  assert.equal(h.audio.musicSlots.filter((slot) => slot.source.playing).length, 1);
});

test('the first game play that never acknowledges startup recovers once', () => {
  const h = harness();
  const incoming = h.audio.musicSlots.find((slot) => slot !== h.active());
  incoming.source.stallNextPlay = true;
  h.audio.play('tap');
  h.audio.setMode('game');
  h.advance(15);
  assert.equal(incoming.source.playing, true, 'first-play failure also needs recovery');
  assert.equal(incoming.source.playCalls, 2);
  assert.equal(incoming.source.volume, 0.22);
  h.advance(60);
  assert.equal(incoming.source.playCalls, 2, 'healthy music must stay continuous');
});

test('re-entering the same game track cannot queue stop on an already stopped player', () => {
  const h = harness({ stoppedStopStalls: true });
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const mode of ['game', 'home']) {
      h.audio.setMode(mode);
      h.advance(2);
      assert.equal(h.active().source.playing, true, `${mode} must start in cycle ${cycle}`);
      assert.equal(h.audio.musicSlots.filter((slot) => slot.source.playing).length, 1);
    }
  }
});

test('returning home before the game player starts preserves the playing home loop', () => {
  const h = harness();
  const home = h.active();
  const incoming = h.audio.musicSlots.find((slot) => slot !== home);
  incoming.source.autoStart = false;
  h.audio.setMode('game');
  h.advance(0.1);
  home.source.currentTime = 17;
  const calls = home.source.playCalls;
  h.audio.setMode('home');
  h.advance(2);
  assert.equal(h.active(), home);
  assert.equal(home.source.currentTime, 17, 'reversing the fade must not restart the old song');
  assert.equal(home.source.playCalls, calls);
  assert.equal(incoming.source.clip, null, 'cancel the abandoned load/play queue');
});

test('a permanently unavailable game loop is reset once while home music continues', () => {
  const h = harness();
  const home = h.active();
  const incoming = h.audio.musicSlots.find((slot) => slot !== home);
  incoming.source.autoStart = false;
  h.audio.setMode('game');
  h.advance(60);
  assert.equal(incoming.source.playCalls, 2, 'one initial attempt and one recovery only');
  assert.equal(home.source.playing, true);
  assert.ok(home.source.volume > 0.18);
});

test('a late STARTED from a cancelled load cannot confirm the replacement game player', () => {
  const h = harness();
  const home = h.active();
  const incoming = h.audio.musicSlots.find((slot) => slot !== home);
  incoming.source.autoStart = false;
  h.audio.setMode('game');
  const abandoned = incoming.source;
  h.audio.setMode('home');
  h.advance(0.1);
  h.audio.setMode('game');
  abandoned.start();
  h.advance(2);
  assert.equal(
    incoming.source.playing,
    false,
    'a stale event must not stand in for the new player',
  );
  assert.equal(home.source.playing, true, 'keep home music until the current request succeeds');
  incoming.source.start();
  h.advance(2);
  assert.equal(home.source.playing, false);
  assert.equal(incoming.source.playing, true);
});

test('pending initial autoplay waits for user activation without rebuilding the player', () => {
  const h = harness({ autoplay: false });
  const slot = h.active();
  const calls = slot.source.playCalls;
  h.advance(60);
  assert.equal(slot.source.playCalls, calls);
  h.audio.play('tap');
  h.advance(15);
  assert.equal(slot.source.playCalls, calls + 1, 'recovery is allowed after a user interaction');
  h.advance(60);
  assert.equal(slot.source.playCalls, calls + 1);
});

test('mute and background discard pending music so a late startup cannot revive it', () => {
  for (const cancel of ['mute', 'hide']) {
    const h = harness();
    const incoming = h.audio.musicSlots.find((slot) => slot !== h.active());
    incoming.source.stallNextPlay = true;
    h.audio.setMode('game');
    h.advance(0.1);
    if (cancel === 'mute') h.mute();
    else h.emit('hide');
    h.advance(30);
    assert.ok(h.audio.musicSlots.every((slot) => slot.source.clip === null));
    assert.ok(h.audio.musicSlots.every((slot) => !slot.source.playing));
    if (cancel === 'mute') h.unmute();
    else h.emit('show');
    h.advance(2);
    assert.equal(h.active().name, 'music');
    assert.equal(h.active().source.playing, true);
  }
});
