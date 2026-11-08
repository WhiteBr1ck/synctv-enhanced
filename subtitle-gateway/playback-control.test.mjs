import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

let source=await readFile(new URL('../synctv-web/src/plugins/sync.ts',import.meta.url),'utf8');
source=source.replace('import { useDebounceFn } from "@vueuse/core";', 'const useDebounceFn=(fn,delay)=>{let timer;return (...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),delay);};};');
source=source.replace('import { Message, MessageType, type Status } from "@/proto/message";', 'const Message={create:value=>value};const MessageType={STATUS:1,SYNC:2,CHECK_STATUS:3,EXPIRED:4};');
source=source.replace('import { ElNotification } from "element-plus";', 'const ElNotification=()=>{};');
source=source.replace('"@/utils/sync-preferences"',JSON.stringify(new URL('../synctv-web/src/utils/sync-preferences.ts',import.meta.url).href));
source=source.replace('"./icons"',JSON.stringify(new URL('../synctv-web/src/plugins/icons.ts',import.meta.url).href));
const {newSyncPlugin}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'transform'})).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(access={ownerControl:true,canControlPlayback:false},session={paused:false}){
 class Element extends EventTarget {
  constructor(){super();this.attrs=new Map();this.children=[];const classes=new Set();this.classList={toggle:(name,on)=>on?classes.add(name):classes.delete(name),contains:name=>classes.has(name)};}
  setAttribute(name,value){this.attrs.set(name,value);}
  append(value){this.children.push(value);}
  remove(){}
  closest(){return null;}
 }
 const previous={document:globalThis.document,localStorage:globalThis.localStorage};
 const doc=Object.assign(new EventTarget(),{createElement:()=>new Element()});globalThis.document=doc;
 globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
 const video=Object.assign(new Element(),{paused:false,currentTime:40,playbackRate:1,play:async()=>{video.paused=false;},pause:()=>{video.paused=true;}});
 const events=new Map(),settings=new Map(),sent=[];
 let rate=1;
 const art={
  isFocus:true,option:{isLive:false},duration:1200,notice:{show:''},template:{$player:new Element(),$progress:new Element()},
  video,muted:false,
  get currentTime(){return video.currentTime;},set currentTime(value){video.currentTime=value;},
  get playbackRate(){return rate;},set playbackRate(value){rate=value;video.playbackRate=value;art.emit('video:ratechange');},
  setting:{show:false,find:name=>settings.get(name),add:item=>settings.set(item.name,item)},
  on(name,fn){events.set(name,[...(events.get(name)||[]),fn]);},
  once(name,fn){const wrapper=(...args)=>{art.off(name,wrapper);return fn(...args);};art.on(name,wrapper);},
  off(name,fn){events.set(name,(events.get(name)||[]).filter(value=>value!==fn));},
  emit(name,...args){for(const fn of [...(events.get(name)||[])])fn(...args);}
 };
 const plugin=newSyncPlugin(message=>{sent.push(message);return true;},{isPlaying:true,currentTime:40,playbackRate:1},()=>0,()=>access,session)(art);
 return {art,plugin,settings,sent,access,doc,async play(){await video.play();art.emit('play');},pause(){video.pause();art.emit('pause');},destroy(){art.emit('destroy');globalThis.document=previous.document;globalThis.localStorage=previous.localStorage;}};
}

test('viewer pause survives periodic checks and owner actions without publishing room status',async()=>{
 const f=fixture();
 try{
  f.pause();assert.equal(f.plugin.isLocallyPaused(),true);
  assert.equal(f.art.template.$player.children[0].textContent,'已暂停跟随');
  const room={isPlaying:true,currentTime:200,playbackRate:1};
  assert.equal(f.plugin.automaticStatus(room),false);
  await f.plugin.setAndNoPublishStatus(room,'成员操作');
  assert.equal(f.art.video.paused,true);assert.equal(f.art.currentTime,40);
  assert.equal(f.sent.length,0);
 }finally{f.destroy();}
});

test('viewer resumes through sync and applies fresh room time without controlling anyone else',async()=>{
 const f=fixture();
 try{
  f.pause();await f.play();
  assert.deepEqual(f.sent.map(msg=>msg.type),[2]);
  assert.equal(f.plugin.isLocallyPaused(),false);
  await f.plugin.setAndNoPublishStatus({isPlaying:true,currentTime:240,playbackRate:1.25},'手动同步');
  assert.equal(f.art.currentTime,240);assert.equal(f.art.video.paused,false);assert.equal(f.art.playbackRate,1.25);
  assert.equal(f.sent.some(msg=>msg.type===1),false);
 }finally{f.destroy();}
});

test('manual sync also releases a local pause and respects a room that is paused',async()=>{
 const f=fixture();
 try{
  f.pause();f.settings.get('syncPlugin').onClick();
  await f.plugin.setAndNoPublishStatus({isPlaying:false,currentTime:190,playbackRate:1},'手动同步');
  assert.equal(f.plugin.isLocallyPaused(),false);assert.equal(f.art.video.paused,true);assert.equal(f.art.currentTime,190);
 }finally{f.destroy();}
});

test('a viewer who paused keeps that choice when the next episode replaces the player',async()=>{
 const session={paused:false},access={ownerControl:true,canControlPlayback:false};
 const first=fixture(access,session);first.pause();first.destroy();
 const second=fixture(access,session);
 try{
  second.art.emit('ready');await tick();
  assert.equal(second.plugin.isLocallyPaused(),true);
  assert.equal(second.art.video.paused,true);
  assert.equal(second.sent.length,0);
 }finally{second.destroy();}
});

test('picture-in-picture pause stays local and programmatic room pauses do not detach a viewer',async()=>{
 const f=fixture();
 try{
  f.art.pip=true;
  await f.plugin.setAndNoPublishStatus({isPlaying:false,currentTime:50,playbackRate:1},'成员操作');
  f.art.emit('video:pause');assert.equal(f.plugin.isLocallyPaused(),false);
  f.art.video.paused=false;f.art.video.paused=true;f.art.emit('video:pause');
  assert.equal(f.plugin.isLocallyPaused(),true);assert.equal(f.sent.length,0);
  f.art.video.paused=false;f.art.emit('video:play');assert.equal(f.sent.at(-1).type,2);
 }finally{f.destroy();}
});

test('viewer progress is read-only and restoring a local quality switch preserves paused state',async()=>{
 const f=fixture();
 try{
  const down=new Event('pointerdown',{cancelable:true});f.art.template.$progress.dispatchEvent(down);
  assert.equal(down.defaultPrevented,true);
  const key=new Event('keydown',{cancelable:true});Object.defineProperty(key,'code',{value:'ArrowRight'});f.doc.dispatchEvent(key);
  assert.equal(key.defaultPrevented,true);
  f.art.playbackRate=2;assert.equal(f.art.playbackRate,1);
  f.art.currentTime=500;f.art.emit('seek');assert.ok(f.art.currentTime<41);
  f.pause();await f.plugin.restoreLocalStatus({isPlaying:true,currentTime:40,playbackRate:1});
  assert.equal(f.art.video.paused,true);assert.equal(f.plugin.isLocallyPaused(),true);
 }finally{f.destroy();}
});

test('permission changes cancel queued publications and restore interactive controls',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture({ownerControl:false,canControlPlayback:true});
 try{
  f.pause();f.access.canControlPlayback=false;f.access.ownerControl=true;f.art.emit('synctv:playback-access');
  t.mock.timers.tick(600);await tick();assert.equal(f.sent.length,0);
  f.access.canControlPlayback=true;f.art.emit('synctv:playback-access');
  const down=new Event('pointerdown',{cancelable:true});f.art.template.$progress.dispatchEvent(down);
  assert.equal(down.defaultPrevented,false);
  await f.play();t.mock.timers.tick(600);await tick();
  assert.equal(f.sent[0].type,1);assert.equal(f.sent[0].playbackStatus.isPlaying,true);
 }finally{f.destroy();t.mock.timers.reset();}
});

test('applying room rate changes does not echo back and destroyed players cannot publish',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture({ownerControl:true,canControlPlayback:true});
 try{
  await f.plugin.setAndNoPublishStatus({isPlaying:true,currentTime:300,playbackRate:1.5},'成员操作');
  t.mock.timers.tick(600);assert.equal(f.sent.length,0);
  f.pause();f.art.emit('destroy');t.mock.timers.tick(600);assert.equal(f.sent.length,0);
 }finally{f.destroy();t.mock.timers.reset();}
});
