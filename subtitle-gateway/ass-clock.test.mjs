import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The production renderer adapter runs unchanged; replace only the WASM worker
// and canvas so the clock's waiting/seeking states are observable in Node.
let source = await readFile(new URL('../synctv-web/src/plugins/artplayer-plugin-ass/index.js', import.meta.url), 'utf8');
source = source.replace('import SubtitlesOctopus from "libass-wasm";', 'const SubtitlesOctopus = globalThis.MockAssRenderer;');
source = source.replace(/^import (workerUrl|wasmUrl|TimesNewRomanFont|fallbackFont) from .+;$/gm, (_, name) => `const ${name} = "${name}";`);
source = source.replace('"../../utils/subtitle-style"', JSON.stringify(new URL('../synctv-web/src/utils/subtitle-style.ts', import.meta.url).href));
const tick = () => new Promise(resolve => setImmediate(resolve));

test('buffering and seeking keep the ASS clock paused through fullscreen and appearance redraws', async () => {
  const originals = { fetch: globalThis.fetch, document: globalThis.document, localStorage: globalThis.localStorage };
  globalThis.fetch = async () => ({ ok: true, text: async () => '' });
  globalThis.document = { baseURI: 'https://example.test/web/' };
  globalThis.localStorage = { getItem: () => null };
  globalThis.MockAssRenderer = class {
    constructor(options) {
      this.worker = {}; this.workerActive = true; this.pixelRatio = 1;
      this.canvasParent = { style: {} }; this.canvas = { width: 1280, height: 720, style: {} };
      setImmediate(options.onReady);
    }
    resize() {} getVideoPosition() { return { width: 1280, height: 720, x: 0, y: 0 }; }
    setRate() {} setTrack() {} dispose() {}
    setIsPaused(paused, time) { this.paused = paused; this.time = time; }
    setCurrentTime(time) { this.time = time; }
  };
  const events = new Map();
  const video = { paused: false, ended: false, seeking: false, readyState: 4, videoWidth: 1280, playbackRate: 1 };
  const art = { video, currentTime: 7, template: { $video: video }, notice: {},
    on(name, callback) { events.set(name, [...(events.get(name) || []), callback]); },
    emit(name, value) { for (const callback of events.get(name) || []) callback(value); } };
  try {
    const plugin = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
    const renderer = plugin()(art);
    art.emit('artplayer-plugin-ass:switch', { content: '[Events]', fonts: [] });
    await tick(); await tick();
    assert.equal(renderer.instance.paused, false);
    art.emit('video:waiting');
    art.emit('fullscreen');
    art.emit('artplayer-plugin-ass:appearance', { scale: 1, lift: 0, color: '#ffffff' });
    assert.equal(renderer.instance.paused, true, 'redrawing cannot restart the clock while video waits');
    art.currentTime = 120;
    video.readyState = 2;
    art.emit('video:seeking'); art.emit('video:seeked'); art.emit('resize');
    assert.equal(renderer.instance.paused, true);
    assert.equal(renderer.instance.time, 120);
    video.readyState = 4; art.emit('video:playing');
    assert.equal(renderer.instance.paused, false);
    assert.equal(renderer.instance.time, 120);
  } finally {
    art.emit('destroy');
    Object.assign(globalThis, originals);
    delete globalThis.MockAssRenderer;
  }
});
