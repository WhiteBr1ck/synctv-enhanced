import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

let source=await readFile(new URL('../synctv-web/src/plugins/audio.ts',import.meta.url),'utf8');
source=source.replace('import Artplayer from "artplayer";','const Artplayer={utils:{isMobile:false}};').replace('import "./audio.css";','');
for(const [name,path] of Object.entries({'@/utils/audio':'../synctv-web/src/utils/audio.ts','./icons':'../synctv-web/src/plugins/icons.ts','@/utils/track-label':'../synctv-web/src/utils/track-label.ts'}))source=source.replaceAll(`"${name}"`,JSON.stringify(new URL(path,import.meta.url).href)).replaceAll(`'${name}'`,JSON.stringify(new URL(path,import.meta.url).href));
const {artplayerEmbeddedAudio}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'transform'})).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const original={document:globalThis.document,HTMLMediaElement:globalThis.HTMLMediaElement,window:globalThis.window,fetch:globalThis.fetch,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval,now:Date.now};
 let now=100000,interval;
 class Media{
  constructor(){this.events=new Map();this.currentTime=0;this.readyState=0;this.paused=true;this.volume=0.3;this.playbackRate=1;this.requests=[];this.playCalls=0;this.seekable={length:0};}
  get muted(){return !!this._muted;}set muted(v){this._muted=v;}
  set src(v){this._src=v;this.requests.push(v);this.readyState=0;this.currentTime=0;}get src(){return this._src;}
  getAttribute(name){return name==='src'?this._src:null;}removeAttribute(){this._src=undefined;}
  load(){}pause(){this.paused=true;}remove(){}canPlayType(){return '';}
  play(){this.playCalls++;this.paused=false;return new Promise((resolve,reject)=>{this.resolvePlay=resolve;this.rejectPlay=reject;});}
  addEventListener(name,cb){this.events.set(name,cb);}dispatchEvent(e){this.events.get(e.type)?.(e);}
 }
 const audio=new Media();audio.dataset={};const video=new Media();Object.assign(video,{currentTime:80,readyState:4,paused:false,seeking:false});
 globalThis.HTMLMediaElement=Media;globalThis.document={createElement:type=>type==='audio'?audio:{textContent:'',innerHTML:''}};
 globalThis.window={location:{origin:'http://example.test'}};globalThis.fetch=async()=>({ok:true,json:async()=>({audioTracks:[{index:1,codec:'eac3',channels:6,language:'jpn',default:true,url:'/audio.mp4'}]})});
 globalThis.setInterval=cb=>{interval=cb;return 0;};globalThis.clearInterval=()=>{};Date.now=()=>now;
 const events=new Map(),art={video,option:{type:'mkv'},plugins:{},template:{$container:{append(){}}},notice:{},controls:{update(){},remove(){}},setting:{find(){},update(){},remove(){}},on(name,cb){events.set(name,[...(events.get(name)||[]),cb]);},emit(name){for(const cb of events.get(name)||[])cb();}};
 artplayerEmbeddedAudio({type:'mkv',embeddedSubtitleSource:'/tracks'})(art);
 return {audio,video,art,advance(seconds){now+=seconds*1000;video.currentTime+=seconds;interval();},cleanup(){art.emit('destroy');Date.now=original.now;delete original.now;Object.assign(globalThis,original);}};
}

test('slow AAC startup keeps one request alive instead of restarting it every five seconds',async()=>{
 const f=fixture();try{
  await tick();assert.equal(f.audio.requests.length,1);
  f.advance(10);f.advance(15);assert.equal(f.audio.requests.length,1,'initial loading must not restart a slow NAS transcode');
  f.audio.readyState=4;f.audio.currentTime=25;f.audio.seekable={length:1,start:()=>0,end:()=>40};f.audio.resolvePlay();await tick();
  f.advance(0);assert.equal(f.audio.requests.length,1);
  f.art.emit('video:seeking');f.video.currentTime=120;f.art.emit('video:seeked');
  assert.equal(f.audio.requests.length,2,'a real video seek opens one new audio position');
 }finally{f.cleanup();}
});

test('an interrupted audio play is not mistaken for an autoplay permission denial',async()=>{
 const f=fixture();try{
  await tick();f.audio.paused=true;f.audio.rejectPlay(Object.assign(new Error('interrupted'),{name:'AbortError'}));await tick();
  assert.equal(f.art.notice.show,undefined);
  f.audio.readyState=4;f.audio.currentTime=0;f.advance(0);assert.equal(f.audio.playCalls,2,'playback can resume after buffering');
 }finally{f.cleanup();}
});

test('startup alignment mutes stale audio, snaps to video time once buffered, and avoids blind restarts',async()=>{
 const f=fixture();try{
  await tick();
  assert.equal(f.audio.muted,true,'audio stays muted until aligned with video');
  f.advance(3);
  f.audio.readyState=4;f.audio.currentTime=0;
  f.audio.seekable={length:1,start:()=>0,end:()=>6};
  f.audio.resolvePlay();await tick();
  f.advance(0);
  assert.equal(f.audio.currentTime,3,'audio snaps directly to expected playback position');
  assert.equal(f.audio.muted,false,'audio unmutes immediately after alignment');
  assert.equal(f.audio.requests.length,1);
 }finally{f.cleanup();}
});

test('unseekable lag recovers with lead compensation and waits until video reaches origin',async()=>{
 const f=fixture();try{
  await tick();
  f.advance(4);
  f.audio.readyState=4;f.audio.currentTime=0;f.audio.seekable={length:0};
  f.audio.resolvePlay();await tick();
  // Still inside alignment grace window -> holds silently instead of thrashing.
  f.advance(1);
  assert.equal(f.audio.requests.length,1);
  assert.equal(f.audio.paused,true);
  // Past 2.5s grace window after readyAt with unseekable drift > 1.2s -> restarts with lead compensation.
  f.advance(3);
  assert.equal(f.audio.requests.length,2);
  const startParam=Number(new URL(f.audio.requests[1]).searchParams.get('start'));
  assert.ok(startParam>f.video.currentTime,'reopened stream starts slightly ahead of video to absorb startup latency');
  // Stream arrives early while video is still behind origin -> stays paused until video catches up.
  f.audio.readyState=4;f.audio.currentTime=0;f.audio.paused=true;
  f.advance(0);
  assert.equal(f.audio.paused,true);
  // Video reaches origin -> resumes in sync and unmutes.
  f.video.currentTime=startParam+0.02;
  f.advance(0);
  assert.equal(f.audio.paused,false);
  assert.equal(f.audio.muted,false);
 }finally{f.cleanup();}
});

test('streams fragmented MP4 through MediaSource when supported and cleans up on destroy',async()=>{
 const originalMS=globalThis.MediaSource,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
 const appended=[],revoked=[];let aborted=false;
 class FakeSourceBuffer{
  constructor(){this.updating=false;this.events=new Map();}
  addEventListener(name,cb){this.events.set(name,cb);}
  removeEventListener(name){this.events.delete(name);}
  appendBuffer(buf){appended.push(buf.byteLength);}
  remove(){}
 }
 class FakeMediaSource{
  static isTypeSupported(mime){return mime.includes('mp4a.40.2');}
  constructor(){this.readyState='open';this.ended=false;}
  addEventListener(){}removeEventListener(){}
  addSourceBuffer(){return new FakeSourceBuffer();}
  endOfStream(){this.ended=true;}
 }
 globalThis.MediaSource=FakeMediaSource;
 URL.createObjectURL=()=>'blob:compat-audio';
 URL.revokeObjectURL=u=>revoked.push(u);
 const f=fixture();
 const origFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(url==='/tracks')return origFetch(url,options);
  options?.signal?.addEventListener('abort',()=>{aborted=true;});
  let sent=0;
  return {
   ok:true,
   body:{
    getReader(){
     return {
      async read(){
       if(sent++===0)return {done:false,value:new Uint8Array([1,2,3,4])};
       return new Promise(()=>{});
      },
      async cancel(){}
     };
    }
   }
  };
 };
 try{
  await tick();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(f.audio.src,'blob:compat-audio');
  assert.deepEqual(appended,[4]);
  f.cleanup();
  assert.equal(aborted,true);
  assert.deepEqual(revoked,['blob:compat-audio']);
 }finally{
  globalThis.MediaSource=originalMS;
  URL.createObjectURL=originalCreate;
  URL.revokeObjectURL=originalRevoke;
 }
});
