import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

let control = await readFile(new URL('../synctv-web/src/plugins/control.ts', import.meta.url), 'utf8');
control = control.replace('import Artplayer from "artplayer";', 'const Artplayer={utils:{isMobile:false}};');
for (const [name, file] of Object.entries({
  './icons': '../synctv-web/src/plugins/icons.ts',
  '@/utils/track-label': '../synctv-web/src/utils/track-label.ts',
  '@/utils/playback-summary': '../synctv-web/src/utils/playback-summary.ts'
})) control = control.replace(`'${name}'`, JSON.stringify(new URL(file, import.meta.url).href));
control += '\nexport const setMobile=value=>{Artplayer.utils.isMobile=value;};';
const {default: mediaControl, setMobile} = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(control, {mode:'transform'})).toString('base64'));

let source = await readFile(new URL('../synctv-web/src/plugins/source.ts', import.meta.url), 'utf8');
source = source.replace('import Artplayer from "artplayer";', '');
source = source.replace('import { destroyOldCustomPlayLib } from "@/utils";', 'const destroyOldCustomPlayLib=art=>{art.cleaned=true;};');
const {artplayPluginSource} = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source, {mode:'transform'})).toString('base64'));

const tick = () => new Promise(resolve => setImmediate(resolve));
const sources = [
  {html:'默认', url:'unplayable-hevc', type:'m3u8'},
  {html:'原画直通 · Episode', url:'original', type:'mkv', playbackMode:'direct'},
  {html:'H.264 兼容 · Episode', url:'compatible', type:'m3u8', playbackMode:'transcode'}
];
function player(initial = sources) {
  const controls = new Map(), settings = new Map(), events = new Map();
  const status = {currentTime:123, isPlaying:true, playbackRate:1};
  const art = {
    isDestroy:false, fullscreen:false, option:{type:'m3u8'}, url:initial[0]?.url,
    controls:{
      update:item=>{art.controls[item.name]=item;controls.set(item.name,item);},
      remove:name=>{delete art.controls[name];controls.delete(name);}
    },
    setting:{update:item=>settings.set(item.name,item), find:name=>settings.get(name), remove:name=>settings.delete(name)},
    loading:{show:false}, notice:{show:''},
    plugins:{syncPlugin:{currentStatus:()=>status, setAndNoPublishStatus:value=>{art.restored=value;}}},
    on(name, callback) { const list=events.get(name)||[]; list.push(callback); events.set(name,list); },
    once(name, callback) { const handler=(...args)=>{art.off(name,handler);callback(...args);}; art.on(name,handler); },
    off(name, callback) { events.set(name,(events.get(name)||[]).filter(item=>item!==callback)); },
    emit(name, value) { for(const callback of [...(events.get(name)||[])])callback(value); }
  };
  // Production installs media control before source, before the first canplay.
  const media = mediaControl()(art); art.plugins[media.name]=media;
  art.plugins.source=artplayPluginSource(initial)(art);
  return {art, controls, settings, status};
}

test('quality choices are available before an unsupported default stream can play', async () => {
  const {art, controls, settings} = player();
  try {
    await tick();
    assert.deepEqual(settings.get('quality')?.selector.map(item=>item.html), ['默认','原画','H.264 兼容']);
    assert.equal(settings.get('quality')?.html, '画质');
  } finally { art.isDestroy=true; art.emit('destroy'); }
});

test('a viewer can switch to H264 before ready and restore progress locally', async () => {
  const {art, controls, settings, status} = player();
  try {
    await tick();
    const menu=settings.get('quality');
    assert.ok(menu, 'decoder recovery must not require a successful first playback');
    menu.onSelect(menu.selector.find(item=>item.html==='H.264 兼容'));
    assert.equal(art.url,'compatible');
    assert.equal(art.plugins.source.currentSource().playbackMode,'transcode');
    assert.ok(settings.has('quality'), 'source switch must restore the quality setting immediately');
    assert.equal(controls.has('quality'),false);
    art.emit('video:canplay');
    assert.deepEqual(art.restored,status);
  } finally { art.isDestroy=true; art.emit('destroy'); }
});

test('source refresh exposes new choices even when the previous source was removed', async () => {
  const {art, controls, settings} = player([]);
  try {
    await tick(); assert.equal(controls.has('quality'),false);
    art.plugins.source.updateSources(sources);
    await tick();
    assert.equal(settings.get('quality')?.selector.length,3);
  } finally { art.isDestroy=true; art.emit('destroy'); }
});

test('mobile settings expose quality before ready and keep the toolbar clean in fullscreen', async () => {
  setMobile(true);
  const {art, controls, settings} = player();
  try {
    await tick();
    assert.equal(controls.has('quality'),false);
    assert.equal(settings.get('quality')?.selector.length,3);
    art.fullscreen=true; art.emit('fullscreen');
    assert.equal(settings.get('quality')?.selector.length,3);
  } finally { art.isDestroy=true; art.emit('destroy'); setMobile(false); }
});

test('iPad web fullscreen keeps quality choices in settings without extra toolbar buttons', async () => {
  setMobile(true);
  const {art, controls, settings} = player();
  try {
    await tick();
    art.fullscreenWeb=true; art.emit('fullscreenWeb',true);
    assert.equal(controls.has('quality'),false);
    assert.equal(settings.get('quality')?.selector.length,3);
    art.fullscreenWeb=false; art.emit('fullscreenWeb',false);
    assert.equal(controls.has('quality'),false);
    assert.equal(settings.get('quality')?.selector.length,3);
  } finally { art.isDestroy=true; art.emit('destroy'); setMobile(false); }
});

test('a destroyed player cannot create controls from delayed initialization', async () => {
  const {art, controls, settings} = player();
  art.isDestroy=true; art.emit('destroy');
  await tick();
  assert.equal(controls.has('quality'),false);
  assert.equal(settings.has('quality'),false);
});

test('a single direct stream keeps no quality menu until alternatives exist', async () => {
  const {art, controls, settings} = player([sources[0]]);
  try {
    await tick();
    assert.equal(controls.has('quality'),false);
    assert.equal(settings.has('quality'),false);
  } finally { art.isDestroy=true; art.emit('destroy'); }
});
