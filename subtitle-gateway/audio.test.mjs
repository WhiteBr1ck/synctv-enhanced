import test from 'node:test';
import assert from 'node:assert/strict';
import { audioInfo } from './video-info.mjs';
import { audioCorrection, audioMime, audioLabel } from '../synctv-web/src/utils/audio.ts';

test('retains both language tracks with duplicate names and exposes only audio metadata', () => {
  const tracks=audioInfo({streams:[{index:0,codec_type:'video'},{index:1,codec_type:'audio',codec_name:'eac3',channels:6,tags:{language:'jpn',title:'Main'},disposition:{default:1}},
    {index:2,codec_type:'audio',codec_name:'eac3',channels:6,tags:{language:'eng',title:'Main'}}]});
  assert.equal(tracks.length,2);assert.ok(tracks[0].default);assert.equal(tracks[1].default,false);
  assert.match(audioLabel(tracks[0]),/日语.*EAC3.*6 声道/);assert.match(audioLabel(tracks[1]),/英语/);
  assert.match(audioMime('eac3'),/ec-3/);assert.equal(audioMime('unknown'),undefined);
});
test('synchronizes audio to room/video time with a bounded speed correction', () => {
  assert.deepEqual(audioCorrection(103,3,100,1),{expected:3,drift:0,rate:1});
  const behind=audioCorrection(103,2,100,2);assert.equal(behind.expected,3);assert.equal(behind.rate,2.08);
  const ahead=audioCorrection(103,4,100,1);assert.equal(ahead.rate,0.96);
});
