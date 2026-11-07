const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
const file = path.resolve(__dirname, '../assets/scripts/core/WechatShareImages.ts');
const mod = new Module(file);
mod._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  file,
);
const { shareImageForMode } = mod.exports;

test('uses the verified image pair for the selected game mode', () => {
  const images = {
    classic: { imageUrlId: 'test-classic', imageUrl: 'https://example.com/classic.jpg' },
    quartet: { imageUrlId: 'test-quartet', imageUrl: 'https://example.com/quartet.jpg' },
    fun: { imageUrlId: 'test-fun', imageUrl: 'https://example.com/fun.jpg' },
  };
  for (const mode of ['classic', 'quartet', 'fun']) {
    assert.deepEqual(shareImageForMode(mode, images), images[mode]);
  }
});

test('does not use an incomplete pair or an image for another mode', () => {
  const images = {
    classic: { imageUrlId: 'test-classic', imageUrl: '' },
    quartet: { imageUrlId: '', imageUrl: 'https://example.com/quartet.jpg' },
  };
  for (const mode of ['classic', 'quartet', 'fun']) {
    assert.equal(shareImageForMode(mode, images), undefined);
  }
  assert.equal(shareImageForMode('classic', {}), undefined);
});

test('each published game mode uses its own configured image pair', () => {
  assert.deepEqual(shareImageForMode('fun'), {
    imageUrlId: 'eS4o6XauRq29yezWdKw6EA==',
    imageUrl:
      'https://mmocgame.qpic.cn/wechatgame/D6MvJrHRtPM9Pg8wnW7LQ0LBFrErCoTzyRS3yC7Luf4s6exngFOPksFeeVJI1RF4/0',
  });
  assert.deepEqual(shareImageForMode('classic'), {
    imageUrlId: 'WKxC6DT6SpWGXS3nU3wbkQ==',
    imageUrl:
      'https://mmocgame.qpic.cn/wechatgame/D6MvJrHRtPN6IqKTLlJnYOJvtpZHwhc2pfmMY41xFMcYQpQ1ibjPB7kEiamLAGFspf/0',
  });
  assert.deepEqual(shareImageForMode('quartet'), {
    imageUrlId: 'Sl/xpz1fSQ2VwyekznINmg==',
    imageUrl:
      'https://mmocgame.qpic.cn/wechatgame/D6MvJrHRtPNbMAqCYFJuGMQYSyiauiaMEOqN6IMgHQ4OGbumuIpwNicibU2LPWNcZXJO/0',
  });
});
