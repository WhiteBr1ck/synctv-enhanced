import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MediaStore } from './media.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8' };

function json(res, status, value) {
  if (res.destroyed) return;
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'Content-Length': body.length, 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

export function createGateway({ upstream = process.env.SYNCTV_UPSTREAM || 'http://synctv:8080',
  webDir = process.env.WEB_DIR || path.join(root, 'web'), cacheDir = process.env.CACHE_DIR || '/cache' } = {}) {
  const target = new URL(upstream);
  const transport = target.protocol === 'https:' ? https : http;
  const store = new MediaStore({ upstream, cacheDir });
  const sockets = new Set();
  const proxy = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://gateway').pathname;
      if (pathname === '/_synctv/health') return json(res, 200, { status: 'ok', embeddedSubtitles: true });
      if (pathname.startsWith('/_synctv/subtitles/')) {
        if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
        const match = /^\/_synctv\/subtitles\/([a-f0-9]{64})\/(tracks|info|track-(\d+)\.(ass|srt|vtt)|font-(\d+)|audio-(\d+)\.mp4)$/.exec(pathname);
        const source = match && store.get(match[1]);
        if (!source) return json(res, 404, { error: '字幕会话已过期，请重新打开视频' });
        if (match[2] === 'tracks') {
          const tracks = await store.tracks(source);
          return json(res, 200, { tracks, audioTracks: source.audioTracks, duration: source.duration });
        }
        if (match[2] === 'info') { await store.tracks(source); return json(res, 200, source.info); }
        if (match[6] !== undefined) {
          const query = new URL(req.url, 'http://gateway').searchParams;
          const start = Number(query.get('start') || 0), rate = Number(query.get('rate') || 1);
          if (!Number.isFinite(start) || start < 0 || start > 86400 || !Number.isFinite(rate) || rate < 0.5 || rate > 5) return json(res, 400, { error: 'Invalid audio position' });
          await store.tracks(source);
          if (!source.audioTracks.some(track => track.index === Number(match[6]))) return json(res, 404, { error: 'Audio track not found' });
          if (source.duration && start >= source.duration) return json(res, 416, { error: 'Audio position out of range' });
          if (req.method === 'HEAD') { res.writeHead(200, { 'Content-Type': 'audio/mp4', 'Cache-Control': 'no-store' }); return res.end(); }
          return store.streamAudio(source, Number(match[6]), start, rate, req, res);
        }
        const isFont = match[5] !== undefined;
        const file = isFont ? await store.font(source, Number(match[5])) : await store.file(source, Number(match[3]), match[4]);
        const info = await stat(file);
        res.writeHead(200, { 'Content-Type': isFont ? 'application/octet-stream' : 'text/plain; charset=utf-8',
          'Content-Length': info.size, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' });
        if (req.method === 'HEAD') return res.end();
        const stream = createReadStream(file);
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        return stream.pipe(res);
      }
      if (['GET', 'HEAD'].includes(req.method) && pathname.startsWith('/web/')) {
        let relative;
        try { relative = decodeURIComponent(pathname.slice('/web/'.length)); }
        catch { return json(res, 400, { error: 'Invalid path' }); }
        const file = path.resolve(webDir, relative);
        if (file.startsWith(path.resolve(webDir) + path.sep)) {
          const info = await stat(file).catch(() => null);
          if (info?.isFile()) {
            res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
              'Content-Length': info.size, 'Cache-Control': relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
            if (req.method === 'HEAD') return res.end();
            const stream = createReadStream(file);
            stream.on('error', () => res.destroy());
            res.on('close', () => stream.destroy());
            return stream.pipe(res);
          }
        }
      }
      const headers = { ...req.headers, 'accept-encoding': 'identity' };
      const forward = transport.request(target, { method: req.method, path: req.url, headers }, response => {
        const current = pathname === '/api/room/movie/current' && response.statusCode === 200;
        const html = response.statusCode === 200 && /text\/html/i.test(response.headers['content-type'] || '');
        if (!current && !html) {
          res.writeHead(response.statusCode, response.headers);
          response.on('error', () => res.destroy());
          response.pipe(res);
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) response.destroy(new Error('Upstream response too large'));
          else chunks.push(chunk);
        });
        response.on('error', () => { if (!res.headersSent) json(res, 502, { error: '读取影片信息失败' }); else res.destroy(); });
        response.on('end', async () => {
          try {
            let body = Buffer.concat(chunks);
            if (html) body = await readFile(path.join(webDir, 'index.html'));
            else {
              const value = JSON.parse(body);
              const movie = value.data?.movie || value.movie;
              const discovery = store.register(movie, req.headers);
              if (discovery) {
                movie.base.embeddedSubtitleSource = discovery;
                movie.base.mediaInfoSource = discovery.replace(/\/tracks$/, '/info');
                movie.base.preferEmbeddedSubtitles = movie.base.vendorInfo?.vendor === 'emby';
              }
              body = Buffer.from(JSON.stringify(value));
            }
            const outgoing = { ...response.headers, 'content-length': body.length, 'cache-control': 'no-store' };
            delete outgoing['transfer-encoding'];
            delete outgoing['content-encoding'];
            delete outgoing.etag;
            res.writeHead(response.statusCode, outgoing);
            res.end(body);
          } catch { json(res, 502, { error: '读取影片信息失败' }); }
        });
      });
      forward.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'SyncTV 服务暂时无法连接' }); else res.destroy(); });
      res.on('close', () => forward.destroy());
      req.pipe(forward);
    } catch (error) {
      if (!res.headersSent) json(res, 502, { error: error.message });
      else res.destroy();
    }
  });

  proxy.on('upgrade', (req, socket, head) => {
    const request = transport.request(target, { path: req.url, headers: req.headers, method: req.method });
    request.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` +
        Object.entries(response.headers).map(([key, value]) => `${key}: ${value}\r\n`).join('') + '\r\n');
      if (head.length) upstreamSocket.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      upstreamSocket.on('error', () => socket.destroy());
      socket.on('error', () => upstreamSocket.destroy());
      socket.on('close', () => upstreamSocket.destroy());
      upstreamSocket.on('close', () => socket.destroy());
      socket.pipe(upstreamSocket).pipe(socket);
    });
    request.on('response', response => {
      socket.end(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`);
      response.resume();
    });
    request.on('error', () => socket.destroy());
    request.end();
  });

  // Preserve SyncTV's multiplexed TCP port: RTMP and other non-HTTP traffic
  // continue directly to the original v0.9.15 server.
  const listener = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(15000, () => socket.destroy());
    let initial = Buffer.alloc(0);
    const identify = chunk => {
      initial = Buffer.concat([initial, chunk]);
      const methods = ['GET ', 'POST ', 'PUT ', 'PATCH ', 'DELETE ', 'HEAD ', 'OPTIONS ', 'CONNECT '];
      const prefix = initial.toString('ascii', 0, 10);
      const isHttp = methods.some(method => prefix.startsWith(method));
      if (!isHttp && methods.some(method => method.startsWith(prefix))) return;
      socket.removeListener('data', identify);
      socket.setTimeout(0);
      socket.pause();
      if (isHttp) {
        socket.unshift(initial);
        proxy.emit('connection', socket);
        socket.resume();
      } else {
        const destination = net.connect({ host: target.hostname, port: Number(target.port) || 80 }, () => {
          destination.write(initial);
          socket.pipe(destination).pipe(socket);
          socket.resume();
        });
        destination.on('error', () => socket.destroy());
        destination.on('close', () => socket.destroy());
        socket.on('close', () => destination.destroy());
      }
    };
    socket.on('data', identify);
  });
  const prune = setInterval(() => store.prune().catch(() => console.error('Subtitle cache cleanup failed')), 600000);
  prune.unref();
  store.prune().catch(() => console.error('Subtitle cache initialization failed'));
  return { listener, store, close: async () => {
    clearInterval(prune);
    for (const child of store.audioStreams) child.kill('SIGKILL');
    for (const socket of sockets) socket.destroy();
    if (listener.listening) await new Promise(resolve => listener.close(resolve));
  } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gateway = createGateway();
  const port = Number(process.env.PORT || 8080);
  gateway.listener.listen(port, '0.0.0.0', () => console.log(`SyncTV v0.9.15 embedded subtitle gateway listening on ${port}`));
  const stop = async () => { await gateway.close(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
