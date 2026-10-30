import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGateway } from './server.mjs';

let temp, upstream, gateway, origin, mediaOrigin, extension = 'mkv', provider = 'alist', mediaRequests = 0;
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
before(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), 'synctv-subtitles-test-'));
  await writeFile(path.join(temp, 'test.ass'), `[Script Info]\nScriptType: v4.00+\nPlayResX: 320\nPlayResY: 180\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Times New Roman,22,&H0000FFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,5,5,8,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:04.80,Default,,0,0,0,,Embedded ASS OK\\N内封字幕测试\n`);
  await writeFile(path.join(temp, 'test.srt'), '1\n00:00:00,000 --> 00:00:04,800\nEmbedded SRT OK\n');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x203040:s=320x180:r=24:d=5',
    '-i', path.join(temp, 'test.ass'), '-i', path.join(temp, 'test.srt'),
    '-map', '0:v', '-map', '1:0', '-map', '2:0', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p', '-c:s', 'copy', '-metadata:s:s:0', 'language=zho', '-metadata:s:s:0', 'title=Chinese ASS',
    '-metadata:s:s:1', 'language=eng', '-disposition:s:0', 'default',
    '-attach', fileURLToPath(new URL('../synctv-web/src/plugins/artplayer-plugin-ass/fonts/TimesNewRoman.ttf', import.meta.url)),
    '-metadata:s:t', 'mimetype=application/x-truetype-font', path.join(temp, 'movie.mkv')]);
  ffmpeg(['-i', path.join(temp, 'movie.mkv'), '-map', '0:v', '-map', '0:s:1', '-c:v', 'copy', '-c:s', 'mov_text',
    '-movflags', '+faststart', path.join(temp, 'movie.mp4')]);
  const font = fileURLToPath(new URL('../synctv-web/src/plugins/artplayer-plugin-ass/fonts/TimesNewRoman.ttf', import.meta.url));
  ffmpeg(['-i', path.join(temp, 'movie.mkv'), '-map', '0:v', '-map', '0:s', '-c', 'copy',
    ...Array.from({ length: 20 }, (_, i) => ['-attach', font, `-metadata:s:t:${i}`, `filename=fixture-${i}.ttf`,
      `-metadata:s:t:${i}`, 'mimetype=application/x-truetype-font']).flat(), path.join(temp, 'movie.fonts.mkv')]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=s=320x180:r=24:d=1', '-c:v', 'libx265', '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1',
    '-x265-params', 'pools=none:frame-threads=1:log-level=error:colorprim=9:transfer=16:colormatrix=9:hdr10=1',
    path.join(temp, 'movie.hdr.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=s=320x180:r=24:d=5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=5',
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'eac3', '-ac', '6', '-metadata:s:a:0', 'language=jpn', '-metadata:s:a:1', 'language=eng',
    '-disposition:a:0', 'default', '-disposition:a:1', '0', path.join(temp, 'movie.audio.mkv')]);
  await writeFile(path.join(temp, 'index.html'), '<html><body>Patched v0.9.15 UI</body></html>');
  upstream = http.createServer(async (req, res) => {
    if (req.url.startsWith('/media.')) {
      mediaRequests++;
      if (req.headers['user-agent'] !== 'TestBrowser/1.0') { res.writeHead(403); return res.end(); }
      const file = path.join(temp, req.url.slice(1).replace(/^media\./, 'movie.'));
      const info = await stat(file);
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Number(range[2]) : info.size - 1;
      res.writeHead(range ? 206 : 200, { 'Content-Type': extension === 'mp4' ? 'video/mp4' : 'video/x-matroska',
        'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}) });
      return createReadStream(file, { start, end }).pipe(res);
    }
    if (req.url === '/api/room/movie/current') {
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.authorization !== 'test-authorized-session') { res.statusCode = 401; return res.end('{"error":"Unauthorized"}'); }
      return res.end(JSON.stringify({ data: { movie: { id: 'movie', base: { type: extension, url: `${mediaOrigin}/media.${extension}`,
        name: 'Fixture', live: false, vendorInfo: { vendor: provider }, subtitles: null } }, status: {} } }));
    }
    if (req.url === '/echo') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return req.pipe(res);
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<html>Old UI</html>');
  });
  upstream.on('upgrade', (req, socket, head) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    if (head.length) socket.write(head);
    socket.on('data', data => socket.write(data));
  });
  mediaOrigin = `http://127.0.0.1:${await listen(upstream)}`;
  gateway = createGateway({ upstream: mediaOrigin, webDir: temp, cacheDir: path.join(temp, 'cache') });
  origin = `http://127.0.0.1:${await listen(gateway.listener)}`;
});
after(async () => {
  await gateway?.close();
  upstream?.closeAllConnections();
  await new Promise(resolve => upstream.close(resolve));
  await rm(temp, { recursive: true, force: true });
});

async function source() {
  const response = await fetch(origin + '/api/room/movie/current', { headers: { Authorization: 'test-authorized-session', 'User-Agent': 'TestBrowser/1.0' } });
  assert.equal(response.status, 200);
  const current = await response.json();
  assert.equal(current.data.movie.base.url, `${mediaOrigin}/media.${extension}`);
  const discovery = current.data.movie.base.embeddedSubtitleSource;
  assert.match(discovery, /^\/_synctv\/subtitles\/[a-f0-9]{64}\/tracks$/);
  return discovery;
}

test('slow subtitle extraction returns polling responses and runs only once across requests', async () => {
  const slow = createGateway({ upstream: mediaOrigin, cacheDir: path.join(temp, 'slow-cache'), subtitleWaitMs: 10 });
  const address = `http://127.0.0.1:${await listen(slow.listener)}`;
  const discovery = slow.store.register({ id:'slow', base:{type:'mkv',url:`${mediaOrigin}/media.mkv`,vendorInfo:{vendor:'alist'}} });
  const url = address + discovery.replace(/tracks$/, 'track-2.srt');
  let complete, calls = 0;
  const pending = new Promise(resolve => { complete = resolve; });
  slow.store.file = async () => { calls++; await pending; return path.join(temp, 'test.srt'); };
  try {
    for (let i=0;i<3;i++) {
      const response = await fetch(url + (i===0?'?retry=1':''));
      assert.equal(response.status,202);
      assert.equal(response.headers.get('retry-after'),'1');
      assert.equal((await response.json()).status,'processing');
    }
    assert.equal(calls,1,'polling must join the running extraction');
    complete();
    const response = await fetch(url);
    assert.equal(response.status,200);
    assert.match(await response.text(),/Embedded SRT OK/);
    assert.equal(calls,1);
  } finally { complete(); await slow.close(); }
});

test('failed background extraction stays failed until an explicit subtitle retry', async () => {
  const slow = createGateway({ upstream: mediaOrigin, cacheDir:path.join(temp,'failed-cache'), subtitleWaitMs:10 });
  const address = `http://127.0.0.1:${await listen(slow.listener)}`;
  const discovery = slow.store.register({id:'failed',base:{type:'mkv',url:`${mediaOrigin}/media.mkv`,vendorInfo:{vendor:'alist'}}});
  const url = address + discovery.replace(/tracks$/, 'track-2.srt');
  let fail, calls=0;
  const pending = new Promise((_,reject)=>{fail=reject;});
  slow.store.file = async () => { if(++calls===1) return pending; return path.join(temp,'test.srt'); };
  try {
    assert.equal((await fetch(url)).status,202);
    fail(new Error('test extraction failed'));
    assert.equal((await fetch(url)).status,502);
    assert.equal((await fetch(url)).status,502);
    assert.equal(calls,1,'failed polls must not keep restarting FFmpeg');
    const retry = await fetch(url+'?retry=1');
    assert.equal(retry.status,200);
    assert.match(await retry.text(),/Embedded SRT OK/);
    assert.equal(calls,2);
  } finally { await slow.close(); }
});

test('preserves authentication and rejects unknown subtitle capabilities', async () => {
  assert.equal((await fetch(origin + '/api/room/movie/current')).status, 401);
  assert.equal((await fetch(origin + '/_synctv/subtitles/' + '0'.repeat(64) + '/tracks')).status, 404);
});
test('serves the patched UI and preserves streaming request bodies', async () => {
  assert.match(await (await fetch(origin + '/')).text(), /Patched v0.9.15/);
  const body = Buffer.alloc(200000, 42);
  assert.deepEqual(Buffer.from(await (await fetch(origin + '/echo', { method: 'POST', body })).arrayBuffer()), body);
});
test('discovers real MKV ASS and SRT tracks and reuses the probe', async () => {
  extension = 'mkv';
  const discovery = await source();
  const result = await (await fetch(origin + discovery)).json();
  assert.deepEqual(result.tracks.map(track => track.type), ['ass', 'srt']);
  assert.equal(result.tracks[0].language, 'zho');
  assert.equal(result.tracks[0].fonts.length, 1);
  const previous = mediaRequests;
  assert.deepEqual(await (await fetch(origin + discovery)).json(), result);
  assert.equal(mediaRequests, previous);
});

test('returns allowlisted video metadata using the same authorized, cached probe as subtitles', async () => {
  extension = 'mkv';
  const discovery = await source();
  await fetch(origin + discovery);
  const previous = mediaRequests;
  const response = await fetch(origin + discovery.replace(/\/tracks$/, '/info'));
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.video.codec, 'h264');
  assert.equal(value.video.width, 320);
  assert.equal(value.video.height, 180);
  assert.equal(value.video.bitDepth, 8);
  assert.equal(value.video.frameRate, 24);
  assert.equal(value.sourceIndex, 0);
  assert.equal(mediaRequests, previous);
  assert.doesNotMatch(JSON.stringify(value), /Authorization|TestBrowser|127\.0\.0\.1|api_key/);
  assert.equal((await fetch(origin + '/_synctv/subtitles/' + '0'.repeat(64) + '/info')).status, 404);
});

test('identifies a real HEVC 10-bit PQ stream with no subtitle tracks', async () => {
  extension = 'hdr.mp4';
  try {
    const discovery = await source();
    const value = await (await fetch(origin + discovery.replace(/\/tracks$/, '/info'))).json();
    assert.equal(value.video.codec, 'hevc');
    assert.equal(value.video.bitDepth, 10);
    assert.equal(value.video.dynamicRange, 'HDR / PQ');
    assert.equal(value.video.colorPrimaries, 'bt2020');
    assert.deepEqual((await (await fetch(origin + discovery)).json()).tracks, []);
  } finally { extension = 'mkv'; }
});

test('streams the chosen E-AC-3 track as audible AAC without including or modifying video', async () => {
  extension = 'audio.mkv';
  try {
    const original = await readFile(path.join(temp, 'movie.audio.mkv'));
    const discovery = await source();
    const {audioTracks} = await (await fetch(origin + discovery)).json();
    assert.deepEqual(audioTracks.map(track => [track.codec,track.channels,track.language]), [['eac3',6,'jpn'],['eac3',6,'eng']]);
    const frequencies=[];
    for (const [i,track] of audioTracks.entries()) {
      const response = await fetch(origin + track.url + '?start=2');
      assert.equal(response.status,200);
      assert.equal(response.headers.get('content-type'),'audio/mp4');
      const file=path.join(temp,`compat-${i}.mp4`);
      await writeFile(file,Buffer.from(await response.arrayBuffer()));
      const probe=spawnSync('ffprobe',['-v','error','-show_streams','-of','json',file],{encoding:'utf8'});
      const streams=JSON.parse(probe.stdout).streams;
      assert.equal(streams.length,1);
      assert.equal(streams[0].codec_name,'aac');assert.equal(streams[0].channels,2);
      const decoded=spawnSync('ffmpeg',['-v','error','-i',file,'-f','s16le','-ac','1','-ar','48000','pipe:1'],{maxBuffer:2*1024*1024});
      assert.equal(decoded.status,0);
      const pcm=decoded.stdout;
      assert.ok(pcm.length>2*48000*2.8 && pcm.length<2*48000*3.2,'seeking returns the remaining audio, not the full file');
      let energy=0,crossings=0;
      for(let j=4098;j<pcm.length-4096;j+=2){const value=pcm.readInt16LE(j);energy+=value*value;
        if(value>0&&pcm.readInt16LE(j-2)<=0)crossings++;}
      assert.ok(energy>1e7,'decoded output contains non-silent PCM');
      frequencies.push(crossings);
    }
    assert.ok(frequencies[1]>frequencies[0]*1.8 && frequencies[1]<frequencies[0]*2.2,'each language selects its own audio stream');
    assert.equal(createHash('sha256').update(await readFile(path.join(temp,'movie.audio.mkv'))).digest('hex'),createHash('sha256').update(original).digest('hex'));
  } finally { extension='mkv'; }
});

test('rejects invalid audio positions and stops FFmpeg when the viewer disconnects', async () => {
  extension='audio.mkv';
  try {
    const discovery=await source();const {audioTracks}=await (await fetch(origin+discovery)).json();
    const url=origin+audioTracks[0].url;
    assert.equal((await fetch(url+'?start=NaN')).status,400);
    assert.equal((await fetch(url+'?start=-1')).status,400);
    assert.equal((await fetch(url+'?start=900')).status,416);
    assert.equal((await fetch(url.replace(/audio-\d+/, 'audio-99'))).status,404);
    const controller=new AbortController();
    const response=await fetch(url,{signal:controller.signal});
    await response.body.getReader().read();controller.abort();
    for(let i=0;i<40&&gateway.store.audioStreams.size;i++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(gateway.store.audioStreams.size,0,'disconnect releases the compatibility audio process');
  } finally {extension='mkv';}
});
test('reads ASS styles, SRT text and attached fonts without modifying the video', async () => {
  extension = 'mkv';
  const discovery = await source();
  const { tracks } = await (await fetch(origin + discovery)).json();
  const before = await stat(path.join(temp, 'movie.mkv'));
  const [ass1, ass2, srt] = await Promise.all([tracks[0], tracks[0], tracks[1]].map(async track => {
    const response = await fetch(origin + track.url);
    assert.equal(response.status, 200, await (response.clone()).text());
    return response.text();
  }));
  assert.equal(ass1, ass2);
  assert.match(ass1, /Times New Roman/);
  assert.match(ass1, /&H0*FFFF/);
  assert.match(ass1, /Embedded ASS OK/);
  assert.match(ass1, /内封字幕测试/);
  assert.match(srt, /Embedded SRT OK/);
  const font = await fetch(origin + tracks[0].fonts[0]);
  assert.equal(font.status, 200);
  assert.deepEqual(Buffer.from(await font.arrayBuffer()), await readFile(fileURLToPath(new URL('../synctv-web/src/plugins/artplayer-plugin-ass/fonts/TimesNewRoman.ttf', import.meta.url))));
  const after = await stat(path.join(temp, 'movie.mkv'));
  assert.equal(before.mtimeMs, after.mtimeMs);
  assert.equal(before.size, after.size);
});
test('reads an MP4 mov_text subtitle as timed text', async () => {
  extension = 'mp4';
  const { tracks } = await (await fetch(origin + await source())).json();
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].type, 'srt');
  assert.match(await (await fetch(origin + tracks[0].url)).text(), /Embedded SRT OK/);
});

test('preserves embedded fonts after the sixteenth attachment and serves the later font', async () => {
  extension = 'fonts.mkv';
  try {
    const discovery = await source();
    const { tracks } = await (await fetch(origin + discovery)).json();
    assert.equal(tracks[0].fonts.length, 20);
    const font = await fetch(origin + tracks[0].fonts[19]);
    assert.equal(font.status, 200);
    assert.deepEqual(Buffer.from(await font.arrayBuffer()), await readFile(fileURLToPath(new URL('../synctv-web/src/plugins/artplayer-plugin-ass/fonts/TimesNewRoman.ttf', import.meta.url))));
    const session = gateway.store.get(discovery.split('/')[3]);
    await assert.rejects(stat(path.join(session.dir, `track-${tracks[0].index}.ass`)), { code: 'ENOENT' }, 'font reads do not scan or extract the episode subtitle');
    const ass = await (await fetch(origin + tracks[0].url)).text();
    assert.match(ass, /Embedded ASS OK/);
  } finally { extension = 'mkv'; }
});
test('registers an Emby/Jellyfin original media stream for embedded subtitle discovery', async () => {
  extension = 'mkv'; provider = 'emby';
  try {
    const response = await fetch(origin + '/api/room/movie/current', { headers: { Authorization: 'test-authorized-session', 'User-Agent': 'TestBrowser/1.0' } });
    const { data: { movie } } = await response.json();
    assert.equal(movie.base.preferEmbeddedSubtitles, true);
    const { tracks } = await (await fetch(origin + movie.base.embeddedSubtitleSource)).json();
    assert.deepEqual(tracks.map(track => track.type), ['ass','srt']);
  } finally { provider = 'alist'; }
});
test('changing an episode behind the same SyncTV proxy URL does not reuse its subtitle session', () => {
  const base = { url: '/api/room/movie/proxy/folder?source=0', type: 'mkv', vendorInfo: { vendor: 'emby' } };
  const first = gateway.store.register({ id: 'folder', subPath: '/Episode 1.mkv', base });
  const second = gateway.store.register({ id: 'folder', subPath: '/Episode 2.mkv', base });
  assert.notEqual(first, second);
});
test('forwards WebSocket upgrade and bidirectional traffic', async () => {
  await new Promise((resolve, reject) => {
    const socket = net.connect(new URL(origin).port, '127.0.0.1', () => socket.write('GET /ws HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
    let upgraded = false;
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('WebSocket forwarding timeout')); });
    socket.on('error', reject);
    socket.on('data', data => {
      if (!upgraded) { assert.match(data.toString(), /101 Switching Protocols/); upgraded = true; socket.write('websocket-echo'); }
      else { assert.equal(data.toString(), 'websocket-echo'); socket.destroy(); resolve(); }
    });
  });
});
test('recognizes an HTTP request whose method arrives in separate TCP packets', async () => {
  await new Promise((resolve, reject) => {
    const socket = net.connect(new URL(origin).port, '127.0.0.1', () => {
      socket.write('GE');
      setTimeout(() => socket.write('T / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'), 20);
    });
    let body = '';
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('Fragmented request timeout')); });
    socket.on('error', reject);
    socket.on('data', data => body += data.toString());
    socket.on('end', () => { assert.match(body, /Patched v0.9.15 UI/); resolve(); });
  });
});
test('preserves the raw TCP path used by RTMP', async () => {
  const echo = net.createServer(socket => socket.pipe(socket));
  const rawGateway = createGateway({ upstream: `http://127.0.0.1:${await listen(echo)}`, webDir: temp, cacheDir: path.join(temp, 'raw-cache') });
  const port = await listen(rawGateway.listener);
  try {
    await new Promise((resolve, reject) => {
      const payload = Buffer.from([3, 0, 1, 2, 3, 42]);
      const socket = net.connect(port, '127.0.0.1', () => socket.write(payload));
      socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('Raw TCP timeout')); });
      socket.on('error', reject);
      socket.once('data', data => { assert.deepEqual(data, payload); socket.destroy(); resolve(); });
    });
  } finally { await rawGateway.close(); await new Promise(resolve => echo.close(resolve)); }
});
