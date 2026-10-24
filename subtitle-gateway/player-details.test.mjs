import test from 'node:test';import assert from 'node:assert/strict';
import {playbackSummary} from '../synctv-web/src/utils/playback-summary.ts';
import {trackLabel,escapeLabel} from '../synctv-web/src/utils/track-label.ts';

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
