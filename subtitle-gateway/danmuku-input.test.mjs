import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

const source = await readFile(new URL('../synctv-web/src/plugins/danmuku-input.ts', import.meta.url), 'utf8');
const {default: inputPlugin, isAppleTouchDevice, playerFullscreenOptions} =
  await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source, {mode:'transform'})).toString('base64'));
const ipad = {userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.0 Safari/605.1.15', platform:'MacIntel', maxTouchPoints:5};
const desktop = {...ipad, maxTouchPoints:0};
const tick = () => new Promise(resolve => queueMicrotask(resolve));

function fixture(device = ipad, withInput = true) {
  class Element extends EventTarget {
    constructor(tagName = 'DIV') {
      super(); this.tagName=tagName; this.attributes=new Map(); this.value='draft';
      const classes=new Set();
      this.classList={
        add:(...names)=>names.forEach(name=>classes.add(name)),
        remove:(...names)=>names.forEach(name=>classes.delete(name)),
        contains:name=>classes.has(name),
        toggle:(name,on)=>on?classes.add(name):classes.delete(name)
      };
      const styles=new Map();
      this.style={setProperty:(name,value)=>styles.set(name,value),getPropertyValue:name=>styles.get(name)||'',removeProperty:name=>styles.delete(name)};
    }
    setAttribute(name,value) { this.attributes.set(name,value); }
    getAttribute(name) { return this.attributes.get(name); }
    closest() { return this.tagName === 'INPUT' ? this : null; }
    click() { this.dispatchEvent(new Event('click')); }
  }
  const input=new Element('INPUT'), send=new Element(), player=new Element(), fullscreenControl=new Element(), controls=new Element();
  const viewport=Object.assign(new EventTarget(),{height:1024,offsetTop:0});
  const win=Object.assign(new EventTarget(),{visualViewport:viewport});
  const doc={activeElement:null};
  input.blur=()=>{doc.activeElement=null;input.dispatchEvent(new Event('blur'));};
  const previous={window:globalThis.window, document:globalThis.document};
  globalThis.window=win; globalThis.document=doc;
  player.querySelector=selector=>withInput?(selector==='.apd-input'?input:send):null;
  player.getBoundingClientRect=()=>({bottom:1024,width:768,height:1024});
  player.contains=element=>element===input || element===send;
  const events=new Map();
  let visible=false;
  const art={
    template:{$player:player,$controls:controls}, isInput:false, fullscreenWeb:false,
    controls:{fullscreenWeb:fullscreenControl,get show(){return visible;},set show(value){visible=value;art.emit('control',value);}},
    on(name,fn){events.set(name,[...(events.get(name)||[]),fn]);},
    off(name,fn){events.set(name,(events.get(name)||[]).filter(item=>item!==fn));},
    emit(name,...args){for(const fn of [...(events.get(name)||[])])fn(...args);}
  };
  inputPlugin(device)(art);
  return {
    art,input,send,player,viewport,fullscreenControl,controls,
    focus(){doc.activeElement=input;input.dispatchEvent(new Event('focus'));},
    blur(){doc.activeElement=null;input.dispatchEvent(new Event('blur'));},
    fullscreen(value){art.fullscreenWeb=value;art.emit('fullscreenWeb',value);},
    destroy(){art.emit('destroy');},
    restore(){globalThis.window=previous.window;globalThis.document=previous.document;}
  };
}

test('iPad desktop user agents and iOS retain document fullscreen without CSS rotation', () => {
  for(const device of [ipad,{userAgent:'iPad',platform:'iPad',maxTouchPoints:5},{userAgent:'iPhone',platform:'iPhone',maxTouchPoints:5}]) {
    assert.equal(isAppleTouchDevice(device),true);
    assert.deepEqual(playerFullscreenOptions(device),{fullscreen:false,fullscreenWeb:true,autoOrientation:false});
  }
  for(const device of [desktop,{userAgent:'Android',platform:'Linux',maxTouchPoints:5},{userAgent:'Windows',platform:'Win32',maxTouchPoints:10}]) {
    assert.equal(isAppleTouchDevice(device),false);
    assert.deepEqual(playerFullscreenOptions(device),{fullscreen:true,fullscreenWeb:true,autoOrientation:true});
  }
});

test('focus without a mouse click keeps controls available, and blur releases them', async () => {
  const f=fixture();
  try {
    f.fullscreen(true);f.focus();
    assert.equal(f.art.isInput,true);
    assert.equal(f.player.classList.contains('synctv-danmuku-editing'),true);
    f.art.controls.show=false;
    assert.equal(f.art.controls.show,true);
    f.blur();await tick();
    assert.equal(f.art.isInput,false);
    f.art.controls.show=false;
    assert.equal(f.art.controls.show,false);
    assert.equal(f.input.value,'draft');
  } finally {f.destroy();f.restore();}
});

test('keyboard resize and viewport pan lift controls while preserving fullscreen and video geometry', async () => {
  const f=fixture();
  try {
    f.fullscreen(true);f.focus();
    f.viewport.height=600;f.viewport.dispatchEvent(new Event('resize'));
    assert.equal(f.player.style.getPropertyValue('--synctv-keyboard-inset'),'424px');
    f.viewport.offsetTop=24;f.viewport.dispatchEvent(new Event('scroll'));
    assert.equal(f.player.style.getPropertyValue('--synctv-keyboard-inset'),'400px');
    assert.equal(f.art.fullscreenWeb,true);
    assert.equal(f.fullscreenControl.getAttribute('aria-label'),'退出全屏');
    assert.deepEqual(f.player.getBoundingClientRect(),{bottom:1024,width:768,height:1024});
    f.blur();await tick();
    assert.equal(f.player.style.getPropertyValue('--synctv-keyboard-inset'),'0px');
    f.fullscreen(false);
    assert.equal(f.fullscreenControl.getAttribute('aria-label'),'全屏');
  } finally {f.destroy();f.restore();}
});

test('Chinese composition does not submit candidates; Enter and the send button still work', () => {
  const f=fixture();let sent=0;
  try {
    f.input.addEventListener('keypress',event=>{if(event.key==='Enter')sent++;});
    const enter=()=>{const event=new Event('keypress',{cancelable:true});Object.defineProperty(event,'key',{value:'Enter'});return event;};
    f.input.dispatchEvent(new Event('compositionstart'));
    const candidate=enter();f.input.dispatchEvent(candidate);
    assert.equal(sent,0);
    assert.equal(candidate.defaultPrevented,false);
    f.input.dispatchEvent(new Event('compositionend'));
    f.input.dispatchEvent(enter());assert.equal(sent,1);
    f.send.addEventListener('click',()=>sent++);
    const key=new Event('keydown',{cancelable:true});Object.defineProperty(key,'key',{value:'Enter'});
    f.send.dispatchEvent(key);assert.equal(sent,2);
    assert.equal(f.input.getAttribute('enterkeyhint'),'send');
    assert.equal(f.send.getAttribute('role'),'button');
  } finally {f.destroy();f.restore();}
});

test('tapping send while editing keeps the keyboard in place until click', () => {
  const f=fixture();let sent=0;
  try {
    f.fullscreen(true);f.focus();
    f.viewport.height=600;f.viewport.dispatchEvent(new Event('resize'));
    f.send.addEventListener('click',()=>sent++);
    const down=new Event('pointerdown',{cancelable:true});f.send.dispatchEvent(down);
    assert.equal(down.defaultPrevented,true);
    f.send.click();
    assert.equal(sent,1);
    assert.equal(f.player.style.getPropertyValue('--synctv-keyboard-inset'),'424px');
    assert.equal(f.art.isInput,true);
    f.blur();
    const otherDown=new Event('pointerdown',{cancelable:true});f.send.dispatchEvent(otherDown);
    assert.equal(otherDown.defaultPrevented,false);
  } finally {f.destroy();f.restore();}
});

test('toolbar taps stay stable while editing and exiting fullscreen dismisses input afterwards', async () => {
  const f=fixture();
  try {
    f.fullscreen(true);f.focus();
    f.viewport.height=600;f.viewport.dispatchEvent(new Event('resize'));
    const down=new Event('pointerdown',{cancelable:true});f.controls.dispatchEvent(down);
    assert.equal(down.defaultPrevented,true);
    assert.equal(f.player.style.getPropertyValue('--synctv-keyboard-inset'),'424px');
    f.fullscreen(false);await tick();
    assert.equal(f.art.isInput,false);
    assert.equal(f.player.classList.contains('synctv-danmuku-editing'),false);
    assert.equal(f.player.style.getPropertyValue('--synctv-keyboard-inset'),'0px');
    assert.equal(f.input.value,'draft');
  } finally {f.destroy();f.restore();}
});

test('desktop fullscreen keeps its layout when a viewport resize occurs during input', () => {
  const f=fixture(desktop);
  try {
    f.fullscreen(true);f.focus();
    f.viewport.height=500;f.viewport.dispatchEvent(new Event('resize'));
    assert.equal(f.player.style.getPropertyValue('--synctv-keyboard-inset'),'0px');
    assert.equal(f.player.classList.contains('synctv-apple-touch'),false);
  } finally {f.destroy();f.restore();}
});

test('destroying a player while blur is queued does not restore old controls or keyboard styles', async () => {
  const f=fixture();
  try {
    f.fullscreen(true);f.focus();f.blur();f.destroy();await tick();
    f.viewport.height=500;f.viewport.dispatchEvent(new Event('resize'));
    assert.equal(f.player.classList.contains('synctv-apple-touch'),false);
    assert.equal(f.player.classList.contains('synctv-danmuku-editing'),false);
    assert.equal(f.player.style.getPropertyValue('--synctv-keyboard-inset'),'');
  } finally {f.restore();}
});

test('a player without the danmuku plugin can still enter and exit web fullscreen', () => {
  const f=fixture(ipad,false);
  try {
    f.fullscreen(true);f.fullscreen(false);
    assert.equal(f.art.fullscreenWeb,false);
  } finally {f.destroy();f.restore();}
});
