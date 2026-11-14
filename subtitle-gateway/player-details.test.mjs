import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
import {playbackSummary} from '../synctv-web/src/utils/playback-summary.ts';
import {trackLabel,escapeLabel} from '../synctv-web/src/utils/track-label.ts';
import {DANMUKU_TOP_SAFE_AREA,danmukuSafeAreaOptions,mountTopRightBadge} from '../synctv-web/src/utils/player-top-bar.ts';

test('reports the selected H264 stream instead of the HEVC original probe',()=>{
  const info=playbackSummary({html:'H.264 兼容 · Episode',type:'m3u8',playbackMode:'transcode'},{codec:'hevc',bitDepth:10,dynamicRange:'HDR / PQ'},[{codec:'eac3',channels:6,default:true}]);
  assert.equal(info.codec,'H.264');assert.equal(info.depth,8);assert.equal(info.dynamicRange,'SDR');assert.equal(info.transcoded,true);assert.match(info.audio,/转码 · AAC · 2 声道/);
});
test('separates container remuxing from audio-only and video transcoding',()=>{
  const info=playbackSummary({html:'默认',type:'m3u8',playbackMode:'transcode',url:'https://media/master.m3u8?AudioCodec=aac&TranscodeReasons=ContainerNotSupported'},{codec:'hevc',bitDepth:10,dynamicRange:'未标注'},[{codec:'eac3',channels:6,default:true}],'SDR','hvc1.2.4.L153.B0','mp4a.40.2');
  assert.equal(info.transcoded,false);assert.equal(info.codec,'HEVC');assert.equal(info.depth,10);assert.equal(info.dynamicRange,'SDR');assert.match(info.audio,/转码 · AAC/);
  const raw=playbackSummary({html:'原画',type:'mkv',playbackMode:'direct'},{codec:'hevc',bitDepth:10,dynamicRange:'HDR / PQ'},[{codec:'flac',channels:2,default:true}]);
  assert.equal(raw.dynamicRange,'HDR');assert.match(raw.audio,/直通 · FLAC/);
  const titled=playbackSummary({html:'原画直通 · Example.H.264.1080p',type:'mkv',playbackMode:'direct'},{codec:'h264',bitDepth:8,dynamicRange:'SDR'});
  assert.equal(titled.transcoded,false);assert.equal(titled.codec,'H.264');assert.match(titled.audio,/直通/);
});
test('track labels preserve origin, language, codec and title without HTML injection',()=>{
  assert.equal(trackLabel({origin:'external',language:'jpn',type:'ass',title:'Signs'},'Subtitle'),'外挂 · 日语 · ASS · Signs');
  assert.equal(trackLabel({origin:'embedded',language:'chi',codec:'aac',title:'国语',default:true},'Audio'),'内封 · 中文 · AAC · 国语（默认）');
  assert.equal(escapeLabel('<img src=x>'),'&lt;img src=x&gt;');
});
test('top-right badge container groups owner control and network speed in deterministic order',()=>{
  const el=(className='')=>{
    const node={
      className,
      children:[],
      ownerDocument:{createElement:()=>el()},
      classList:{contains:(name)=>node.className.split(/\s+/).includes(name)},
      append(...items){this.children.push(...items);},
      prepend(...items){this.children.unshift(...items);}
    };
    return node;
  };
  const player=el('art-video-player');
  const speed=el('synctv-network-speed');
  const follow=el('synctv-follow-status');
  const first=mountTopRightBadge(player,speed,'end');
  const second=mountTopRightBadge(player,follow,'start');
  assert.equal(first,second);
  assert.equal(player.children.length,1);
  assert.equal(first.className,'synctv-top-badges');
  assert.deepEqual(first.children.map(item=>item.className),['synctv-follow-status','synctv-network-speed']);
});
test('danmuku safe area keeps top lanes below movie title and matches slider steps',()=>{
  const opts=danmukuSafeAreaOptions();
  assert.equal(DANMUKU_TOP_SAFE_AREA,48);
  assert.deepEqual(opts.margin,[48,'25%']);
  const activeStep=opts.MARGIN.steps.findIndex(s=>s.value[0]===opts.margin[0]&&s.value[1]===opts.margin[1]);
  assert.equal(opts.MARGIN.steps[activeStep]?.name,'3/4');
  for(const step of opts.MARGIN.steps)assert.equal(step.value[0],DANMUKU_TOP_SAFE_AREA);

  const workerSrc=fs.readFileSync(new URL('../synctv-web/node_modules/artplayer-plugin-danmuku/src/worker.js',import.meta.url),'utf8');
  const ctx={self:{postMessage(){}},onmessage:null};
  vm.runInNewContext(workerSrc,ctx);
  for(const mode of [0,1]){
    const top=ctx.getDanmuTop({
      target:{mode,height:28,speed:180},
      visibles:[],
      antiOverlap:true,
      clientWidth:960,
      clientHeight:540,
      marginTop:opts.margin[0],
      marginBottom:540*0.25
    });
    assert.equal(top,48);
  }
});
