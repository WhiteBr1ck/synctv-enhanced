import test from 'node:test';
import assert from 'node:assert/strict';
import { videoInfo } from './video-info.mjs';
import { describePlayback, describeVideo, basicDecodeType } from '../synctv-web/src/utils/video-info.ts';

test('identifies HDR transfer functions without calling all 10-bit video HDR', () => {
  const stream = { codec_type: 'video', codec_name: 'hevc', pix_fmt: 'yuv420p10le', width: 3840, height: 2160, avg_frame_rate: '24000/1001' };
  const parse = extra => videoInfo({ streams: [{ ...stream, ...extra }] });
  assert.equal(parse({ color_transfer: 'smpte2084' }).dynamicRange, 'HDR / PQ');
  assert.equal(parse({ color_transfer: 'arib-std-b67' }).dynamicRange, 'HDR / HLG');
  assert.equal(parse({ color_transfer: 'bt709' }).dynamicRange, 'SDR');
  assert.equal(parse({}).dynamicRange, '未标注');
  assert.equal(parse({}).bitDepth, 10);
  assert.equal(parse({}).frameRate, 24000 / 1001);
  assert.equal(parse({ avg_frame_rate: '0/0' }).frameRate, undefined);
  assert.equal(parse({ side_data_list: [{ side_data_type: 'DOVI configuration record', dv_profile: 5 }] }).dynamicRange, 'Dolby Vision P5');
  assert.equal(parse({ side_data_list: [{ side_data_type: 'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)' }] }).dynamicRange, 'HDR10+');
});

test('skips cover art and does not expose media URLs or arbitrary probe tags', () => {
  const info = videoInfo({ streams: [
    { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
    { codec_type: 'video', codec_name: 'hevc', pix_fmt: 'yuv420p', tags: { secret: 'private-token' } }
  ], format: { filename: 'http://private/?token=secret' } });
  assert.equal(info.codec, 'hevc');
  assert.equal(info.bitDepth, 8);
  assert.doesNotMatch(JSON.stringify(info), /private|secret|filename|tags/);
  assert.equal(videoInfo({ streams: [] }), null);
});

test('reports server decisions without inferring transcoding from HLS or HDR filenames', () => {
  assert.match(describePlayback('direct', 'emby', '默认', 'mkv'), /直播放/);
  assert.match(describePlayback('transcode', 'emby', '默认', 'm3u8'), /转封装 \/ 转码/);
  assert.match(describePlayback(undefined, 'emby', '默认', 'm3u8'), /未知/);
  assert.match(describePlayback(undefined, 'alist', 'raw', 'mkv'), /原文件直通/);
  assert.match(describePlayback(undefined, undefined, 'HDR10', 'mp4'), /未知/);
  assert.match(basicDecodeType({codec: 'hevc', bitDepth: 10}), /hvc1\.2/);
  assert.equal(basicDecodeType({codec: 'unknown'}), undefined);
  assert.match(describeVideo({codec: 'hevc', width: 3840, height: 2160, bitDepth: 10}), /HEVC.*3840 × 2160.*10 bit/);
});
