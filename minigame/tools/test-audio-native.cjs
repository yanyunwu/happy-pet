// Native-boundary regression, not an iPhone/WeChat device test.
// Uses the installed Creator 3.8.8 AudioSource, minigame player, operation queue,
// and real WeChat onPlay/onPause/onStop polyfill. Only the native device and scene
// plumbing are controlled substitutes. Timers and native playback use virtual time.
//
// node minigame/tools/test-audio-native.cjs

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');

const repository = path.resolve(__dirname, '../..');
const engine = 'C:/ProgramData/cocos/editors/Creator/3.8.8/resources/resources/3d/engine';
const controllerPath = path.join(repository, 'minigame/assets/scripts/ui/WoodlandAudio.ts');
const controllerText = fs.readFileSync(controllerPath, 'utf8');

class EventTarget {
  constructor() {
    this.listeners = new Map();
  }
  on(event, callback, target) {
    const list = this.listeners.get(event) || [];
    list.push({ callback, target, once: false });
    this.listeners.set(event, list);
  }
  once(event, callback, target) {
    this.on(event, callback, target);
    this.listeners.get(event).at(-1).once = true;
  }
  off(event, callback, target) {
    if (!callback) {
      this.listeners.delete(event);
      return;
    }
    this.listeners.set(
      event,
      (this.listeners.get(event) || []).filter(
        (item) => item.callback !== callback || (target && item.target !== target),
      ),
    );
  }
  emit(event, ...values) {
    // Listeners registered by a callback belong to the next emission.
    const listeners = [...(this.listeners.get(event) || [])];
    for (const item of listeners) {
      if (item.once) this.off(event, item.callback, item.target);
      item.callback.apply(item.target, values);
    }
  }
}

class Timers {
  now = 0;
  nextId = 1;
  pending = new Map();
  setTimeout = (callback, delay = 0, ...values) => {
    const id = this.nextId++;
    this.pending.set(id, { due: this.now + delay, callback, values });
    return id;
  };
  clearTimeout = (id) => this.pending.delete(id);
  async settle() {
    // A native callback resolves the player's queue, then the AudioSource play
    // Promise emits STARTED. Drain both timers and Promise turns, in that order.
    for (let round = 0; round < 20; round++) {
      // A callback may enqueue another timer; defer it to the next drain turn.
      const pending = [...this.pending];
      for (const [id, timer] of pending) {
        if (timer.due <= this.now && this.pending.delete(id)) {
          timer.callback(...timer.values);
        }
      }
      await Promise.resolve();
    }
  }
}

function compile(filename, requireModule, timers, text = fs.readFileSync(filename, 'utf8')) {
  const mod = { exports: {} };
  const output = ts.transpileModule(text, {
    fileName: filename.endsWith('.ts') ? filename : `${filename}.ts`,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      experimentalDecorators: true,
    },
  }).outputText;
  const execute = vm.compileFunction(
    output,
    ['require', 'module', 'exports', 'setTimeout', 'clearTimeout'],
    { filename },
  );
  execute(requireModule, mod, mod.exports, timers.setTimeout, timers.clearTimeout);
  return mod.exports;
}

async function scenario({
  polyfill,
  failFirstGame,
  briefFirstGame = false,
  briefEveryGame = false,
}) {
  const timers = new Timers();
  const natives = [];
  let gameContextCount = 0;
  let startedEvents = 0;
  const systemInfo = new EventTarget();
  const game = new EventTarget();
  const Game = { EVENT_HIDE: 'hide', EVENT_SHOW: 'show' };

  class NativeAudio extends EventTarget {
    id = natives.length + 1;
    currentTime = 0;
    duration = 60;
    volume = 1;
    loop = false;
    actualPlaying = false;
    destroyed = false;
    playCalls = 0;
    nativePlayEvents = 0;
    gameOrdinal = 0;
    playedSeconds = 0;
    set src(value) {
      this.url = value;
      if (value === 'audio/music') this.gameOrdinal = ++gameContextCount;
      if (!value.startsWith('audio/music')) this.duration = 1;
      timers.setTimeout(() => this.emit('canplay'), 0);
    }
    get src() {
      return this.url;
    }
    play() {
      this.playCalls++;
      // Fault model: the first game native context never starts. No native
      // onPlay event, no currentTime advancement. A new context is healthy.
      if (failFirstGame && this.gameOrdinal === 1) return;
      assert.equal(this.destroyed, false, 'cannot play a destroyed native context');
      this.actualPlaying = true;
      timers.setTimeout(() => {
        if (!this.destroyed) {
          this.nativePlayEvents++;
          this.emit('play');
        }
      }, 0);
    }
    pause() {
      this.actualPlaying = false;
      timers.setTimeout(() => this.emit('pause'), 0);
    }
    stop() {
      this.actualPlaying = false;
      this.currentTime = 0;
      timers.setTimeout(() => this.emit('stop'), 0);
    }
    seek(time) {
      this.currentTime = time;
      timers.setTimeout(() => this.emit('seeked'), 0);
    }
    destroy() {
      this.actualPlaying = false;
      this.destroyed = true;
      this.listeners.clear();
    }
    advance(dt) {
      if (!this.actualPlaying || this.destroyed) return;
      // Another startup failure: one real clock sample arrives, then output
      // stalls while the engine continues reporting PLAYING.
      if (
        ((briefFirstGame && this.gameOrdinal === 1) || (briefEveryGame && this.gameOrdinal > 0)) &&
        this.playedSeconds >= 0.02
      ) {
        this.actualPlaying = false;
        return;
      }
      this.playedSeconds += dt;
      this.currentTime += dt;
      if (this.currentTime >= this.duration) {
        if (this.loop) this.currentTime %= this.duration;
        else {
          this.actualPlaying = false;
          this.currentTime = 0;
          this.emit('ended');
        }
      }
    }
  }
  for (const [method, event] of Object.entries({
    Play: 'play',
    Pause: 'pause',
    Stop: 'stop',
    Seeked: 'seeked',
    Ended: 'ended',
    Canplay: 'canplay',
    Error: 'error',
  })) {
    NativeAudio.prototype[`on${method}`] = function (callback) {
      this.on(event, callback);
    };
    NativeAudio.prototype[`off${method}`] = function (callback) {
      this.off(event, callback);
    };
  }
  const wx = {
    createInnerAudioContext() {
      const native = new NativeAudio();
      natives.push(native);
      return native;
    },
  };
  const constants = {
    EDITOR: false,
    USE_XR: false,
    HUAWEI: false,
    VIVO: false,
    OPPO: false,
    TAOBAO: false,
    TAOBAO_MINIGAME: false,
  };
  const util = compile(
    path.join(engine, 'pal/utils.js'),
    (name) => {
      if (name === 'internal:constants') return constants;
      if (name === '@cocos/engine/cocos/core/platform/debug') return { warnID() {} };
      throw new Error(`Unexpected utils dependency: ${name}`);
    },
    timers,
  );
  const minigame = {
    createInnerAudioContext: polyfill
      ? util.createInnerAudioContextPolyfill(
          wx,
          { onPlay: true, onPause: true, onStop: true, onSeek: false },
          true,
        )
      : wx.createInnerAudioContext,
  };
  const audioTypes = compile(path.join(engine, 'pal/audio/type.js'), () => {}, timers);
  const operations = compile(path.join(engine, 'pal/audio/operation-queue.js'), () => {}, timers);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const miniPlayer = compile(
    path.join(engine, 'pal/audio/minigame/player-minigame.js'),
    (name) => {
      switch (name) {
        case 'pal/minigame':
          return { minigame };
        case 'pal/system-info':
          return { systemInfo };
        case 'internal:constants':
          return constants;
        case '@cocos/engine/cocos/core/event':
          return { EventTarget };
        case '../type.js':
          return audioTypes;
        case '@cocos/engine/cocos/core':
          return { clamp, clamp01: (value) => clamp(value, 0, 1) };
        case '../operation-queue.js':
          return operations;
        default:
          throw new Error(`Unexpected minigame dependency: ${name}`);
      }
    },
    timers,
  );
  const player = compile(
    path.join(engine, 'pal/audio/minigame/player.js'),
    (name) => {
      if (name === './player-minigame.js') return miniPlayer;
      if (name === '@cocos/engine/cocos/core/global-exports') return { legacyCC: {} };
      throw new Error(`Unexpected wrapper dependency: ${name}`);
    },
    timers,
  );

  class Node extends EventTarget {
    addComponent(Type) {
      const component = new Type();
      component.node = this;
      return component;
    }
    emit(event, ...values) {
      if (event === 'started') startedEvents++;
      super.emit(event, ...values);
    }
  }
  class Component {
    isValid = true;
    node = new Node();
    destroy() {
      this.onDestroy?.();
      this.isValid = false;
      return true;
    }
  }
  const decorator = () => () => undefined;
  const { AudioSource } = compile(
    path.join(engine, 'cocos/audio/audio-source.ts'),
    (name) => {
      switch (name) {
        case 'pal/audio':
          return player;
        case 'cc.decorator':
          return {
            ccclass: decorator,
            help: decorator,
            menu: decorator,
            tooltip: decorator,
            type: decorator,
            range: decorator,
            serializable() {},
          };
        case '../../pal/audio/type':
          return audioTypes;
        case '../scene-graph/component':
          return { Component };
        case '../core':
          return { clamp, warn() {} };
        case './audio-clip':
          return { AudioClip: class {} };
        case './audio-manager':
          return {
            audioManager: {
              removePlaying() {},
              addPlaying() {},
              discardOnePlayingIfNeeded() {},
            },
          };
        case '../scene-graph':
          return { Node };
        default:
          throw new Error(`Unexpected AudioSource dependency: ${name}`);
      }
    },
    timers,
  );
  const { WoodlandAudio } = compile(
    controllerPath,
    (name) => {
      assert.equal(name, 'cc');
      return {
        _decorator: { ccclass: decorator },
        AudioSource,
        AudioClip: class {},
        Component,
        Node,
        game,
        Game,
        resources: {
          load(url, _type, callback) {
            callback(null, {
              _nativeAsset: { url },
              getDuration() {
                return 60;
              },
            });
          },
        },
      };
    },
    timers,
    controllerText,
  );
  const audio = new WoodlandAudio();
  audio.configure(() => true);
  await timers.settle();

  let measureGameGap = false;
  let gap = 0;
  let maxGap = 0;
  const advance = async (seconds) => {
    const frames = Math.ceil(seconds / 0.02);
    for (let frame = 0; frame < frames; frame++) {
      const dt = Math.min(0.02, seconds - frame * 0.02);
      timers.now += dt * 1000;
      for (const native of natives) native.advance(dt);
      await timers.settle();
      audio.update(dt);
      await timers.settle();
      if (measureGameGap) {
        const audible = natives.some(
          (native) =>
            native.loop && native.actualPlaying && !native.destroyed && native.volume > 0.02,
        );
        gap = audible ? 0 : gap + dt;
        maxGap = Math.max(maxGap, gap);
      }
    }
  };
  const snapshots = [];
  const snapshot = (label) => {
    const selected = audio.musicSlots.find((slot) => slot.target === 1);
    const native = selected?.source._player?._ccprivate$_player?._ccprivate$_innerAudioContext;
    const value = {
      label,
      seconds: Number((timers.now / 1000).toFixed(2)),
      enginePlaying: selected?.source.playing,
      controllerStarted: selected?.started,
      engineCurrentTime: Number((selected?.source.currentTime || 0).toFixed(2)),
      nativeCurrentTime: Number((native?.currentTime || 0).toFixed(2)),
      nativeActuallyPlaying: native?.actualPlaying,
      nativePlayEvents: native?.nativePlayEvents,
      nativePlayCalls: native?.playCalls,
      nativeGameContexts: gameContextCount,
      resumingAt: selected?.resumingAt,
      resetAttempted: selected?.resetAttempted,
      audibleMusic: natives
        .filter((item) => item.loop && item.actualPlaying && !item.destroyed && item.volume > 0.002)
        .map((item) => item.src),
    };
    snapshots.push(value);
    return value;
  };
  await advance(2);
  snapshot('home_before_entry');
  audio.play('tap');
  audio.setMode('game');
  measureGameGap = true;
  await advance(2);
  const first = snapshot('first_game_after_2s');
  await advance(13);
  snapshot('first_game_after_15s');
  await advance(45);
  const longWait = snapshot('first_game_after_60s');
  measureGameGap = false;
  audio.play('tap');
  await advance(0.12);
  const effectsCanProgress = natives.some(
    (native) => native.src === 'audio/tap' && native.actualPlaying && native.currentTime > 0,
  );
  audio.setMode('home');
  await advance(2);
  snapshot('returned_home_after_2s');
  audio.setMode('game');
  await advance(2);
  const second = snapshot('second_game_after_2s');
  audio.onDestroy();
  await timers.settle();
  assert.ok(
    natives.every((native) => !native.actualPlaying),
    'cleanup stops native contexts',
  );
  return {
    polyfill,
    failFirstGame,
    briefFirstGame,
    briefEveryGame,
    maxSilentGapSeconds: Number(maxGap.toFixed(3)),
    startedEvents,
    effectsCanProgress,
    snapshots,
    falseAcknowledgementBlindSpot:
      first.enginePlaying &&
      first.nativeCurrentTime === 0 &&
      first.audibleMusic.length === 0 &&
      longWait.nativeCurrentTime === 0 &&
      longWait.nativeGameContexts === 1 &&
      second.nativeCurrentTime > 0,
  };
}

(async () => {
  const results = [];
  for (const options of [
    { polyfill: true, failFirstGame: false },
    { polyfill: false, failFirstGame: true },
    { polyfill: true, failFirstGame: true },
    { polyfill: true, failFirstGame: false, briefFirstGame: true },
    { polyfill: true, failFirstGame: false, briefEveryGame: true },
  ])
    results.push(await scenario(options));
  const [healthy, withoutPolyfill, wechat, briefStartup, persistentBriefStartup] = results;
  const point = (result, label) => result.snapshots.find((item) => item.label === label);
  assert.ok(point(healthy, 'first_game_after_2s').nativeCurrentTime > 0, 'healthy control works');
  assert.ok(
    point(withoutPolyfill, 'first_game_after_15s').nativeCurrentTime > 0,
    'missing native acknowledgement is recovered by the existing timeout without the polyfill',
  );
  const report = {
    controller: controllerPath,
    deviceTest: false,
    simulatedFailure:
      'The first game native context either never starts or advances only 0.02s before stalling; replacement contexts work.',
    engineSources: [
      'cocos/audio/audio-source.ts',
      'pal/audio/minigame/player.js',
      'pal/audio/minigame/player-minigame.js',
      'pal/audio/operation-queue.js',
      'pal/utils.js',
    ].map((file) => path.join(engine, file)),
    results,
  };
  const output = path.join(repository, 'minigame/output/qa-audio');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'cold-start-native.json'), JSON.stringify(report, null, 2));
  assert.equal(wechat.falseAcknowledgementBlindSpot, false);
  assert.ok(
    point(wechat, 'first_game_after_2s').audibleMusic.includes('audio/music-home'),
    'retain audible home music until the game native playback actually advances',
  );
  assert.ok(
    point(wechat, 'first_game_after_15s').nativeCurrentTime > 0,
    'rebuild the game player when synthetic onPlay is not followed by real progress',
  );
  assert.equal(
    point(wechat, 'first_game_after_60s').nativeGameContexts,
    2,
    'recover once, then keep the healthy replacement',
  );
  assert.deepEqual(point(wechat, 'first_game_after_15s').audibleMusic, ['audio/music']);
  assert.deepEqual(point(wechat, 'second_game_after_2s').audibleMusic, ['audio/music']);
  assert.ok(wechat.effectsCanProgress, 'native effects remain functional during the recovery flow');
  assert.ok(
    briefStartup.maxSilentGapSeconds < 0.1,
    `a brief initial clock advance must not cause a silent gap: ${briefStartup.maxSilentGapSeconds}s`,
  );
  assert.ok(point(briefStartup, 'first_game_after_15s').nativeCurrentTime > 0);
  assert.equal(
    point(persistentBriefStartup, 'first_game_after_60s').nativeGameContexts,
    2,
    'one small clock sample cannot authorize repeated rebuilding of a permanently failing player',
  );
  assert.equal(persistentBriefStartup.maxSilentGapSeconds, 0);
  console.log(
    'PASS — real Creator WeChat adapter: false acknowledgement, missing acknowledgement, brief startup stall without a gap, and healthy playback.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
