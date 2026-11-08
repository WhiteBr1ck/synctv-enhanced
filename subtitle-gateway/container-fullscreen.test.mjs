import test from 'node:test';
import assert from 'node:assert/strict';
import {containerFullscreen} from '../synctv-web/src/utils/container-fullscreen.ts';

function fixture(prefix=false){
 const doc=new EventTarget(),player=new EventTarget(),changes=[];
 let input=false,fallbacks=0,videoCalls=0;
 player.querySelector=()=>input?{}:null;
 const field=prefix?'webkitFullscreenElement':'fullscreenElement';
 const changed=()=>doc.dispatchEvent(new Event(prefix?'webkitfullscreenchange':'fullscreenchange'));
 player[prefix?'webkitRequestFullscreen':'requestFullscreen']=async()=>{doc[field]=player;changed();};
 doc[prefix?'webkitExitFullscreen':'exitFullscreen']=async()=>{doc[field]=null;changed();};
 player.webkitEnterFullscreen=()=>videoCalls++;
 const controller=containerFullscreen(player,doc,{change:value=>changes.push(value),inputExit:()=>fallbacks++});
 return {controller,doc,player,changes,focus(){input=true;const event=new Event('focusin');Object.defineProperty(event,'target',{value:{matches:()=>true}});player.dispatchEvent(event);},systemExit(){doc[field]=null;changed();},get fallbacks(){return fallbacks;},get videoCalls(){return videoCalls;}};
}

test('standard and prefixed fullscreen request the player container and exit explicitly',async()=>{
 for(const prefix of [false,true]){
  const f=fixture(prefix);
  try{
   assert.equal(f.controller.supported(),true);await f.controller.enter();assert.equal(f.controller.active(),true);
   f.focus();await f.controller.exit();assert.equal(f.controller.active(),false);
   assert.deepEqual(f.changes,[true,false]);assert.equal(f.fallbacks,0);assert.equal(f.videoCalls,0);
  }finally{f.controller.destroy();}
 }
});

test('keyboard-triggered native exit switches back to web mode once',async()=>{
 const f=fixture();
 try{await f.controller.enter();f.focus();f.systemExit();assert.equal(f.fallbacks,1);f.systemExit();assert.equal(f.fallbacks,1);}
 finally{f.controller.destroy();}
});

test('a browser with only native video fullscreen does not enter a UI that drops ASS and chat',async()=>{
 const f=fixture();delete f.player.requestFullscreen;
 try{assert.equal(f.controller.supported(),false);await assert.rejects(f.controller.enter(),/unavailable/);assert.equal(f.videoCalls,0);}
 finally{f.controller.destroy();}
});

test('an unrelated fullscreen exit and destroyed player do not change playback layout',async()=>{
 const f=fixture();
 f.systemExit();assert.equal(f.fallbacks,0);
 await f.controller.enter();f.focus();f.controller.destroy();f.systemExit();
 assert.equal(f.fallbacks,0);assert.deepEqual(f.changes,[false,true]);
});
