const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');

function load(relative, dependencies) {
  const file = path.resolve(__dirname, '../assets/scripts', relative);
  if (!fs.existsSync(file)) return {};
  const mod = new Module(file);
  if (dependencies) mod.require = (name) => dependencies[name] || {};
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
  return mod.exports;
}

const { MatchGame } = load('core/MatchGame.ts');
const { IdleHintClock, selectIdleHint } = load('core/IdleHint.ts');
const animations = [];
const { StarIsle } = load('StarIsle.ts', {
  cc: {
    Component: class {},
    _decorator: { ccclass: () => (target) => target, property: () => () => {} },
    Vec3: class {
      constructor(x, y, z) {
        Object.assign(this, { x, y, z });
      }
    },
    tween(target) {
      const animation = {
        target,
        stopped: false,
        to() {
          return this;
        },
        delay() {
          return this;
        },
        repeatForever() {
          return this;
        },
        start() {
          animations.push(this);
          return this;
        },
        stop() {
          this.stopped = true;
        },
      };
      return animation;
    },
  },
  './core/IdleHint': { IdleHintClock, selectIdleHint },
});

test('idle hint is delayed, resets on input, and fires only once', () => {
  assert.equal(typeof IdleHintClock, 'function', 'idle hint clock exists');
  const clock = new IdleHintClock(10);
  assert.equal(clock.advance(9.9, true), false);
  clock.reset();
  assert.equal(clock.advance(9.9, true), false);
  assert.equal(clock.advance(0.1, true), true);
  assert.equal(clock.advance(10, true), false);
  assert.equal(clock.advance(1, false), false);
  assert.equal(clock.advance(10, true), true);
});

test('idle hint chooses one uncovered board tile matching the tray, never a covered or reserve tile', () => {
  assert.equal(typeof selectIdleHint, 'function', 'idle hint selector exists');
  const game = Object.create(MatchGame.prototype);
  game.status = 'playing';
  game.tiles = [
    { id: 0, kind: 2, x: 0, y: 0, layer: 0, removed: true }, // tray
    { id: 1, kind: 2, x: 0, y: 0, layer: 0, removed: false }, // covered
    { id: 2, kind: 3, x: 0, y: 0, layer: 1, removed: false }, // cover
    { id: 3, kind: 2, x: 300, y: 0, layer: 0, removed: false }, // available match
    { id: 4, kind: 2, x: 600, y: 0, layer: 0, removed: true }, // reserve
  ];
  game.tray = [0];
  game.reserve = [4];
  assert.equal(selectIdleHint(game), 3);
  game.tiles[3].removed = true;
  assert.equal(selectIdleHint(game), null);
  game.tray = [];
  game.tiles[3].removed = false;
  assert.equal(selectIdleHint(game), null);
});

test('game resets idle timer on input and hides its bounce while paused', () => {
  assert.equal(typeof StarIsle.prototype.resetIdleHint, 'function', 'game listens for interaction');
  const app = Object.create(StarIsle.prototype);
  const game = Object.create(MatchGame.prototype);
  game.status = 'playing';
  game.tiles = [
    { id: 0, kind: 2, x: 0, y: 0, layer: 0, removed: true },
    { id: 1, kind: 2, x: 100, y: 0, layer: 0, removed: false },
  ];
  game.tray = [0];
  game.reserve = [];
  const tile = {
    isValid: true,
    position: {
      x: 1,
      y: 2,
      z: 0,
      clone() {
        return { ...this };
      },
    },
    setPosition(position) {
      this.position = position;
    },
  };
  Object.assign(app, {
    game,
    gameClub: { setVisible() {} },
    currentScreen: 'game',
    gameRoot: { activeInHierarchy: true },
    levelTransition: { active: false },
    modals: { current: null },
    idleHintClock: new IdleHintClock(10),
    tileNodes: new Map([[1, tile]]),
    playTime: 0,
  });
  animations.length = 0;
  app.update(9);
  app.resetIdleHint();
  app.update(9);
  assert.equal(animations.length, 0);
  app.update(1);
  assert.equal(animations.length, 1);
  app.modals.current = {};
  app.update(1);
  assert.equal(animations[0].stopped, true);
});
