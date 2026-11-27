import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

// Exercise the real loader with delayed HTTP responses. Only Artplayer's DOM
// adapter is replaced; parsing, selection, aborts and discovery run unchanged.
let source=await readFile(new URL('../synctv-web/src/plugins/subtitle.ts',import.meta.url),'utf8');
source=source.replace('import Artplayer from "artplayer";','const Artplayer={utils:{isMobile:false}};');
source=source.replace('import { subtitlePicker, type FolderSubtitle } from "./subtitle-picker";', 'const subtitlePicker=(_root,_load,select)=>({open(){globalThis.pickFolderSubtitle=select;globalThis.loadFolderSubtitles=_load;},close(){}});');
for(const [name,path] of Object.entries({'./timed-text':'../synctv-web/src/plugins/timed-text.ts','@/utils/track-label':'../synctv-web/src/utils/track-label.ts','@/utils/ass-fonts':'../synctv-web/src/utils/ass-fonts.ts','./icons':'../synctv-web/src/plugins/icons.ts'}))source=source.replace(`"${name}"`,JSON.stringify(new URL(path,import.meta.url).href));
const {artplayerSubtitle}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'transform'})).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const text=value=>({ok:true,text:async()=>value});
function player(){
  const events=new Map(),controls=new Map(),settings=new Map(),state={visible:false,tracks:[]};
  const subtitle=Object.create({get cues(){return [];},get activeCues(){return [];}});
  Object.assign(subtitle,{show:false,update(){}});
  return {state,controls: {update:v=>controls.set(v.name,v)},setting:{update:v=>settings.set(v.name,v)},subtitle,
    template:{$subtitle:{textContent:'',classList:{toggle(){}}}},
    on:(name,callback)=>events.set(name,[...(events.get(name)||[]),callback]),
    emit(name,value){if(name==='artplayer-plugin-ass:visible')state.visible=value;if(name==='artplayer-plugin-ass:switch'){state.visible=true;state.tracks.push(value);}for(const cb of events.get(name)||[])cb(value);},
    notice:{show:''},currentTime:10,subtitleOffset:0,
    select:key=>settings.get('subtitle').onSelect({key})};
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

test('same-folder exact matches replace the automatic track without fetching unrelated subtitles',async()=>{
  const fetchBefore=globalThis.fetch,storageBefore=globalThis.localStorage,listing=deferred(),calls=[];
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  globalThis.fetch=async(url,options)=>{calls.push({url,headers:options?.headers});if(url==='folder')return listing.promise;if(url==='native')return text('native ASS');if(url==='exact')return text('1\n00:00:09,000 --> 00:00:12,000\nExact sidecar\n');throw Error('unrelated subtitle fetched');};
  const art=player();
  try{
    artplayerSubtitle({native:{url:'native',type:'ass',origin:'embedded',default:true}},undefined,false,{url:'folder',headers:{Authorization:'room-token'}})(art);
    await tick();assert.equal(art.state.tracks[0].content,'native ASS');
    listing.resolve({ok:true,json:async()=>({data:{tracks:[{name:'Episode.ass',url:'exact',type:'srt',origin:'external',matchRank:2},{name:'Episode.zh.srt',url:'language',type:'srt',language:'zh',matchRank:1},{name:'Other.srt',url:'other',type:'srt',matchRank:0}]}})});
    await tick();assert.equal(art.subtitle.activeCues[0].text,'Exact sidecar');
    assert.deepEqual(calls.find(x=>x.url==='exact').headers,{Authorization:'room-token'});
    assert.equal(calls.some(x=>x.url==='other'||x.url==='language'),false);
  }finally{art.emit('destroy');globalThis.fetch=fetchBefore;globalThis.localStorage=storageBefore;}
});

test('late folder discovery respects manual selection and disabled subtitle preference',async()=>{
  const fetchBefore=globalThis.fetch,storageBefore=globalThis.localStorage;
  try{
    for(const disabled of[false,true]){
      const listing=deferred();globalThis.localStorage={getItem:()=>disabled?JSON.stringify({enabled:false}):null,setItem(){}};
      const calls=[];globalThis.fetch=async url=>{calls.push(url);return url==='folder'?listing.promise:text('manual ASS');};
      const art=player();
      artplayerSubtitle({native:{url:'native',type:'ass'}},undefined,false,{url:'folder',headers:{}})(art);
      if(!disabled)art.select('');
      listing.resolve({ok:true,json:async()=>({tracks:[{name:'Episode.srt',url:'sidecar',type:'srt',matchRank:2}]})});
      await tick();assert.equal(calls.includes('sidecar'),false);assert.equal(art.state.visible,false);art.emit('destroy');
    }
  }finally{globalThis.fetch=fetchBefore;globalThis.localStorage=storageBefore;}
});

test('a nonmatching folder subtitle is loaded only after the user selects it',async()=>{
  const fetchBefore=globalThis.fetch,storageBefore=globalThis.localStorage;
  const file={name:'Custom subtitle.srt',url:'custom',type:'srt',origin:'external',matchRank:0};const calls=[];
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  globalThis.fetch=async url=>{calls.push(url);return url==='folder'?{ok:true,json:async()=>({tracks:[file]})}:text('1\n00:00:09,000 --> 00:00:12,000\nManually added\n');};
  const art=player();
  try{
    artplayerSubtitle({},undefined,false,{url:'folder',headers:{}})(art);await tick();
    assert.equal(calls.includes('custom'),false);
    art.select('folder:add');globalThis.pickFolderSubtitle(file);await tick();
    assert.equal(art.subtitle.activeCues[0].text,'Manually added');assert.equal(calls.includes('custom'),true);
  }finally{art.emit('destroy');delete globalThis.pickFolderSubtitle;globalThis.fetch=fetchBefore;globalThis.localStorage=storageBefore;}
});

test('leaving an episode aborts folder discovery and ignores the old response',async()=>{
 const fetchBefore=globalThis.fetch,storageBefore=globalThis.localStorage,listing=deferred();let signal;
 globalThis.localStorage={getItem:()=>null,setItem(){}};
 globalThis.fetch=(_url,options)=>{signal=options.signal;return listing.promise;};const art=player();
 try{
  artplayerSubtitle({},undefined,false,{url:'folder',headers:{}})(art);art.emit('destroy');assert.equal(signal.aborted,true);
  listing.resolve({ok:true,json:async()=>({tracks:[{name:'old.ass',url:'old',type:'ass',matchRank:2}]})});await tick();
  assert.equal(art.state.tracks.length,0);assert.equal(art.notice.show,'');
 }finally{globalThis.fetch=fetchBefore;globalThis.localStorage=storageBefore;}
});

test('folder read failures leave playback alone and allow a manual retry and refresh',async()=>{
 const fetchBefore=globalThis.fetch,storageBefore=globalThis.localStorage,calls=[];
 globalThis.localStorage={getItem:()=>null,setItem(){}};
 globalThis.fetch=async url=>{calls.push(url);return calls.length===1?{ok:false,json:async()=>({error:'Directory unavailable'})}:{ok:true,json:async()=>({tracks:[]})};};const art=player();
 try{
  artplayerSubtitle({},undefined,false,{url:'folder?movieId=one',headers:{}})(art);await tick();assert.equal(art.notice.show,'');
  art.select('folder:add');assert.deepEqual(await globalThis.loadFolderSubtitles(),[]);await globalThis.loadFolderSubtitles(true);
  assert.deepEqual(calls,['folder?movieId=one','folder?movieId=one','folder?movieId=one&refresh=1']);
 }finally{art.emit('destroy');delete globalThis.pickFolderSubtitle;delete globalThis.loadFolderSubtitles;globalThis.fetch=fetchBefore;globalThis.localStorage=storageBefore;}
});

test('reports subtitle loading status across discovery, embedded extraction, ASS font loading, ready, and close',async()=>{
 const fetchBefore=globalThis.fetch,storageBefore=globalThis.localStorage;
 const discovery=deferred(),firstPoll=deferred(),secondPoll=deferred();
 let pollCount=0;
 globalThis.localStorage={getItem:()=>null,setItem(){}};
 globalThis.fetch=async url=>{
  if(url==='tracks')return discovery.promise;
  if(url.startsWith('/_synctv/subtitles/abc/track-2.ass')){
   pollCount++;
   return pollCount===1?firstPoll.promise:secondPoll.promise;
  }
  throw new Error(`Unexpected fetch: ${url}`);
 };
 const art=player();
 try{
  const plugin=artplayerSubtitle({},'tracks',true)(art);
  assert.equal(plugin.status(),'探测字幕轨道中…');
  discovery.resolve({ok:true,json:async()=>({tracks:[{url:'/_synctv/subtitles/abc/track-2.ass',type:'ass',index:2,language:'chi',title:'简体',default:true,fonts:['f1.ttf','f2.ttf']}]})});
  await tick();
  assert.match(plugin.status(),/^读取字幕中 · 内封 · 中文 · ASS · 简体/);
  firstPoll.resolve({status:202,ok:false,headers:{get:()=>'0.05'}});
  await tick();
  assert.match(plugin.status(),/^提取内封字幕中（\d+ 秒）· 内封 · 中文 · ASS · 简体/);
  await new Promise(resolve=>setTimeout(resolve,65));
  secondPoll.resolve(text('[Script Info]\nTitle: Demo\n'));
  await tick();
  art.emit('artplayer-plugin-ass:status',{state:'loading',fonts:2});
  assert.match(plugin.status(),/^加载字体与渲染器（2 个字体）· 内封 · 中文 · ASS · 简体/);
  art.emit('artplayer-plugin-ass:status',{state:'ready'});
  assert.match(plugin.status(),/^已就绪 · 内封 · 中文 · ASS · 简体/);
  art.select('');await tick();
  assert.equal(plugin.status(),'已关闭（共 1 条可用）');
 }finally{art.emit('destroy');globalThis.fetch=fetchBefore;globalThis.localStorage=storageBefore;}
});

test('progressive embedded subtitles render immediately and upgrade silently in the background',async()=>{
 const fetchBefore=globalThis.fetch,storageBefore=globalThis.localStorage;
 globalThis.localStorage={getItem:()=>null,setItem(){}};
 const calls=[];
 let step=0;
 globalThis.fetch=async(url,options)=>{
  calls.push({url,headers:options?.headers});
  step++;
  if(step===1){
   return {
    status:200,ok:true,
    headers:{get:name=>({ 'X-Subtitle-Partial':'1','X-Subtitle-Covered':'15','Retry-After':'0.05' }[name]||null)},
    text:async()=>'1\n00:00:09,000 --> 00:00:12,000\nEarly cue\n'
   };
  }
  return {
   status:200,ok:true,
   headers:{get:()=>null},
   text:async()=>'1\n00:00:09,000 --> 00:00:12,000\nEarly cue\n\n2\n00:05:00,000 --> 00:05:03,000\nLater cue\n'
  };
 };
 const art=player();
 try{
  const plugin=artplayerSubtitle({track:{url:'/_synctv/subtitles/test/track-2.srt',type:'srt',origin:'embedded',language:'zho',title:'简体'}})(art);
  await tick();
  assert.equal(calls[0].headers['X-Subtitle-Progressive'],'1');
  assert.equal(calls[0].headers['X-Subtitle-Time'],'10');
  assert.equal(art.subtitle.show,true);
  assert.equal(art.subtitle.activeCues[0].text,'Early cue');
  assert.match(plugin.status(),/^已就绪（后台补全中）/);
  await new Promise(resolve=>setTimeout(resolve,120));
  assert.equal(art.subtitle.cues.length,2);
  assert.match(plugin.status(),/^已就绪 ·/);
 }finally{art.emit('destroy');globalThis.fetch=fetchBefore;globalThis.localStorage=storageBefore;}
});

test('progressive ASS updates emit in-place track updates without recreating the renderer',async()=>{
 const fetchBefore=globalThis.fetch,storageBefore=globalThis.localStorage;
 globalThis.localStorage={getItem:()=>null,setItem(){}};
 let step=0;
 const updates=[];
 globalThis.fetch=async()=>{
  step++;
  if(step===1){
   return {
    status:200,ok:true,
    headers:{get:name=>({ 'X-Subtitle-Partial':'1','X-Subtitle-Covered':'15','Retry-After':'0.05' }[name]||null)},
    text:async()=>'[Events]\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Line 1\n'
   };
  }
  return {
   status:200,ok:true,
   headers:{get:()=>null},
   text:async()=>'[Events]\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Line 1\nDialogue: 0,0:00:20.00,0:00:22.00,Default,,0,0,0,,Line 2\n'
  };
 };
 const art=player();
 art.on('artplayer-plugin-ass:update',content=>updates.push(content));
 try{
  artplayerSubtitle({track:{url:'/_synctv/subtitles/test/track-2.ass',type:'ass',origin:'embedded',language:'chi'}})(art);
  await tick();
  assert.equal(art.state.tracks.length,1);
  await new Promise(resolve=>setTimeout(resolve,120));
  assert.equal(art.state.tracks.length,1,'must not recreate ASS renderer during background completion');
  assert.equal(updates.length,1);
  assert.match(updates[0],/Line 2/);
 }finally{art.emit('destroy');globalThis.fetch=fetchBefore;globalThis.localStorage=storageBefore;}
});

test('automatic selection prefers Chinese tracks over English default and matches preferred language across formats',async()=>{
 const fetchBefore=globalThis.fetch,storageBefore=globalThis.localStorage;
 const chosen=[];
 globalThis.fetch=async url=>{chosen.push(url);return text('1\n00:00:09,000 --> 00:00:12,000\nOK\n');};
 try{
  // Case 1: Saved chi+ass preference falls back to zho+srt instead of English default.
  globalThis.localStorage={getItem:()=>JSON.stringify({enabled:true,language:'chi',type:'ass',origin:'embedded'}),setItem(){}};
  const art1=player();
  artplayerSubtitle({
   eng:{url:'eng',type:'srt',origin:'embedded',language:'eng',title:'English',default:true},
   cht:{url:'cht',type:'srt',origin:'embedded',language:'zho',title:'繁體中文'},
   chs:{url:'chs',type:'srt',origin:'embedded',language:'zho',title:'简体中文'}
  })(art1);
  await tick();
  assert.deepEqual(chosen,['chs']);
  art1.emit('destroy');

  // Case 2: No preference picks non-forced Simplified Chinese over English default and forced Chinese.
  chosen.length=0;
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  const art2=player();
  artplayerSubtitle({
   eng:{url:'eng',type:'srt',origin:'embedded',language:'eng',title:'English',default:true},
   forced:{url:'forced',type:'srt',origin:'embedded',language:'chi',title:'简体 Forced',forced:true},
   cht:{url:'cht',type:'srt',origin:'embedded',language:'chi',title:'Traditional'},
   chs:{url:'chs',type:'srt',origin:'embedded',language:'chi',title:'Simplified'}
  })(art2);
  await tick();
  assert.deepEqual(chosen,['chs']);
  art2.emit('destroy');
 }finally{globalThis.fetch=fetchBefore;globalThis.localStorage=storageBefore;}
});
