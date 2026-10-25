const fs = require('node:fs'),
  vm = require('node:vm'),
  assert = require('node:assert/strict');
const screenSource = fs.readFileSync('build-templates/wechatgame/first-screen.js', 'utf8');
const preloadResources = require('../build-templates/wechatgame/preload-resources.js');
function deadline(promise, ms = 1200) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('startup callback did not settle')), ms);
    promise.then(
      (value) => {
        clearTimeout(t);
        resolve(value);
      },
      (error) => {
        clearTimeout(t);
        reject(error);
      },
    );
  });
}
function harness(source, { frames = true, drawError = false } = {}) {
  const timers = new Set();
  let errors = 0,
    objects = 0;
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  };
  const cancel = (t) => {
    clearTimeout(t);
    timers.delete(t);
  };
  const gl = new Proxy(
    {},
    {
      get: (_, key) => {
        if (/^[A-Z_0-9]+$/.test(key)) return 1;
        if (String(key).startsWith('create')) return () => ({ id: ++objects });
        if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => true;
        if (key === 'getAttribLocation') return (_, name) => (name === 'a_Position' ? 0 : 1);
        if (key === 'getUniformLocation') return () => ({});
        if (String(key).startsWith('delete'))
          return (value) => assert.ok(value, 'never delete a null native GL object');
        if (key === 'drawArrays')
          return () => {
            if (drawError) throw new Error('simulated draw interruption');
          };
        return () => {};
      },
    },
  );
  class Image {
    constructor() {
      this.width = 720;
      this.height = 1560;
    }
    set src(_) {
      later(() => this.onload && this.onload(), 1);
    }
  }
  const canvas = { width: 720, height: 1560, getContext: () => gl },
    sandbox = {
      module: { exports: {} },
      window: { canvas, devicePixelRatio: 3 },
      canvas,
      Image,
      Promise,
      Float32Array,
      Uint8Array,
      console: {
        log() {},
        warn() {
          errors++;
        },
      },
      setTimeout: later,
      clearTimeout: cancel,
      requestAnimationFrame: (fn) => (frames ? later(fn, 8) : 0),
      cancelAnimationFrame: cancel,
    };
  vm.runInNewContext(source, sandbox);
  return {
    screen: sandbox.module.exports,
    cleanup: () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
    warnings: () => errors,
  };
}
(async () => {
  const checks = [];
  // Reproduce the old dead wait independently of a browser or simulator.
  const baseline = 'output/backup-ios-startup/first-screen.js';
  if (fs.existsSync(baseline)) {
    const old = harness(fs.readFileSync(baseline, 'utf8'), { frames: false });
    try {
      await assert.rejects(
        deadline(old.screen.start('default', 'default', 'false'), 350),
        /did not settle/,
      );
      checks.push('original splash stalls when its frame callback stops');
    } finally {
      old.cleanup();
    }
  }
  for (const options of [{ frames: true }, { frames: false }, { frames: true, drawError: true }]) {
    const env = harness(screenSource, options);
    try {
      await deadline(env.screen.start('default', 'default', 'false'));
      await deadline(
        Promise.all([
          env.screen.setProgress(0.2),
          env.screen.setProgress(0.4),
          env.screen.setProgress(0.6),
        ]),
      );
      await deadline(env.screen.end());
      await deadline(env.screen.setProgress(1), 100);
      if (options.drawError) assert.ok(env.warnings() > 0);
      checks.push(`frame bridge settles and releases native objects: ${JSON.stringify(options)}`);
    } finally {
      env.cleanup();
    }
  }
  const progress = [];
  let call;
  const cold = preloadResources(
    {
      loadSubpackage(options) {
        call = options;
        return {
          onProgressUpdate(fn) {
            fn({ progress: 25 });
            fn({ progress: 70 });
            setTimeout(options.success, 2);
          },
        };
      },
    },
    (p) => progress.push(p),
    100,
  );
  await deadline(cold);
  assert.equal(call.name, 'resources');
  assert.deepEqual(progress, [0, 0.25, 0.7, 1]);
  checks.push('real subpackage progress completes before engine handoff');
  await preloadResources(
    {
      loadSubpackage(options) {
        options.success();
      },
    },
    () => {},
    100,
  );
  checks.push('cached subpackage may finish synchronously');
  await assert.rejects(
    preloadResources(
      {
        loadSubpackage(options) {
          options.fail({ errMsg: 'offline' });
        },
      },
      () => {},
      100,
    ),
    /offline/,
  );
  await assert.rejects(
    preloadResources(
      {
        loadSubpackage() {
          return {};
        },
      },
      () => {},
      20,
    ),
    /超时/,
  );
  checks.push('subpackage failure and missing callback reject instead of hanging');
  fs.writeFileSync(
    'output/wechat-startup-qa.json',
    JSON.stringify(
      {
        success: true,
        checks,
        limitation:
          'Frame interruption and strict GL tests simulate failure conditions; they are not a substitute for an actual iPhone run.',
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS — ${checks.length} WeChat startup checks, including reproduction of the original frame wait.`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
