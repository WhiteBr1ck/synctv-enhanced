import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

// Exercise the real loader with delayed HTTP responses. Only Artplayer's DOM
// adapter is replaced; parsing, selection, aborts and discovery run unchanged.
let source=await readFile(new URL('../synctv-web/src/plugins/subtitle.ts',import.meta.url),'utf8');
source=source.replace('import Artplayer from "artplayer";','const Artplayer={utils:{isMobile:false}};');
for(const [name,path] of Object.entries({'./timed-text':'../synctv-web/src/plugins/timed-text.ts','@/utils/track-label':'../synctv-web/src/utils/track-label.ts','@/utils/ass-fonts':'../synctv-web/src/utils/ass-fonts.ts','./icons':'../synctv-web/src/plugins/icons.ts'}))source=source.replace(`"${name}"`,JSON.stringify(new URL(path,import.meta.url).href));
const {artplayerSubtitle}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'transform'})).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const text=value=>({ok:true,text:async()=>value});
function player(){
  const events=new Map(),controls=new Map(),state={visible:false,tracks:[]};
  const subtitle=Object.create({get cues(){return [];},get activeCues(){return [];}});
  Object.assign(subtitle,{show:false,update(){}});
  return {state,controls: {update:v=>controls.set(v.name,v)},setting:{update(){}},subtitle,
    template:{$subtitle:{textContent:'',classList:{toggle(){}}}},
    on:(name,callback)=>events.set(name,[...(events.get(name)||[]),callback]),
    emit(name,value){if(name==='artplayer-plugin-ass:visible')state.visible=value;if(name==='artplayer-plugin-ass:switch'){state.visible=true;state.tracks.push(value);}for(const cb of events.get(name)||[])cb(value);},
    notice:{show:''},currentTime:10,subtitleOffset:0,
    select:key=>controls.get('subtitle').onSelect({key})};
}

test('episode subtitles start before discovery and add fonts without scanning the original movie again',async()=>{
  const originalFetch=globalThis.fetch,originalStorage=globalThis.localStorage;
  const discovery=deferred(); const requests=[];
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  globalThis.fetch=async url=>{requests.push(url);if(url==='native')return text('native ASS');if(url==='tracks')return discovery.promise;throw new Error('Unnecessary original movie extraction');};
  const art=player();
  try{
    artplayerSubtitle({native:{url:'native',type:'ass',origin:'embedded',language:'chi',index:2,default:true}},'tracks',true)(art);
    await tick();assert.equal(art.state.tracks[0].content,'native ASS');
    discovery.resolve({ok:true,json:async()=>({tracks:[{url:'embedded',type:'ass',index:2,language:'chi',default:true,fonts:['font.ttf']}]})});
    await tick();assert.equal(art.state.visible,true);
    assert.equal(art.state.tracks.at(-1).content,'native ASS');assert.deepEqual(art.state.tracks.at(-1).fonts,['font.ttf']);
    assert.ok(!requests.includes('embedded'));
  }finally{art.emit('destroy');globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;}
});

test('late subtitle responses cannot replace a newer selection or a destroyed episode',async()=>{
  const originalFetch=globalThis.fetch,originalStorage=globalThis.localStorage;
  const first=deferred(),second=deferred();
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  globalThis.fetch=async url=>url==='first'?first.promise:second.promise;
  const art=player();
  try{
    artplayerSubtitle({first:{url:'first',type:'ass'},second:{url:'second',type:'ass'}})(art);
    art.select('second');second.resolve(text('second ASS'));await tick();
    first.resolve(text('stale ASS'));await tick();
    assert.deepEqual(art.state.tracks.map(t=>t.content),['second ASS']);
    const pending=deferred();globalThis.fetch=()=>pending.promise;art.select('first');art.emit('destroy');pending.resolve(text('destroyed ASS'));await tick();
    assert.deepEqual(art.state.tracks.map(t=>t.content),['second ASS']);
  }finally{globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;}
});

test('a background subtitle job is polled until the actual timed text is ready',async()=>{
  const originalFetch=globalThis.fetch,originalStorage=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  const requests=[];
  globalThis.fetch=async url=>{requests.push(url);return requests.length===1?{status:202,ok:true,headers:{get:()=> '0.05'}}:text('1\n00:00:09,000 --> 00:00:12,000\nReady after extraction\n');};
  const art=player();
  try {
    artplayerSubtitle({track:{url:'/_synctv/subtitles/test/track-2.srt',type:'srt'}})(art);
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.deepEqual(requests,['/_synctv/subtitles/test/track-2.srt?retry=1','/_synctv/subtitles/test/track-2.srt']);
    assert.equal(art.subtitle.show,true);
    assert.equal(art.subtitle.activeCues[0].text,'Ready after extraction');
    assert.equal(art.notice.show,'');
  } finally {art.emit('destroy');globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;}
});

test('leaving an episode stops subtitle polling without showing a read error',async()=>{
  const originalFetch=globalThis.fetch,originalStorage=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  let calls=0;
  globalThis.fetch=async()=>{calls++;return {status:202,ok:true,headers:{get:()=> '0.05'}};};
  const art=player();
  try {
    artplayerSubtitle({track:{url:'/_synctv/subtitles/test/track-2.srt',type:'srt'}})(art);
    await tick();art.emit('destroy');
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(calls,1);
    assert.doesNotMatch(art.notice.show,/失败|Aborted/);
  } finally {globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;}
});
