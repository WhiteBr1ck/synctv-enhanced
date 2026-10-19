import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createReadStream } from 'node:fs';
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
