import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { videoInfo, audioInfo } from './video-info.mjs';

const codecs = { ass: 'ass', ssa: 'ass', subrip: 'srt', srt: 'srt', mov_text: 'srt', text: 'srt', webvtt: 'vtt' };
const maxSubtitle = 15 * 1024 * 1024;
const maxFont = 20 * 1024 * 1024;
const ttl = 6 * 60 * 60 * 1000;

class Jobs {
  active = 0;
  waiting = [];
  async run(task) {
    if (this.active >= 2) {
      if (this.waiting.length >= 12) throw new Error('字幕处理繁忙，请稍后重试');
      await new Promise(resolve => this.waiting.push(resolve));
    } else this.active++;
    try { return await task(); }
    finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

function run(binary, args, { timeout = 25000, limit = 2 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0, failure;
    const kill = message => { failure = new Error(message); child.kill('SIGKILL'); };
    const timer = setTimeout(() => kill('读取字幕超时，请重试'), timeout);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > limit) kill('字幕信息超过大小限制');
      else chunks.push(chunk);
    });
    // Drain stderr, but never log media URLs, cookies or authorization headers.
    child.stderr.resume();
    child.once('error', () => { clearTimeout(timer); reject(new Error('字幕解析程序无法启动')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error('无法读取该视频的内封字幕'));
      else resolve(Buffer.concat(chunks));
    });
  });
}

function inputArgs(source) {
  const headers = Object.entries(source.headers)
    .filter(([name]) => !/^(user-agent|host|connection|content-length|accept-encoding)$/i.test(name))
    .map(([name, value]) => `${name}: ${value}\r\n`).join('');
  const ua = Object.entries(source.headers).find(([name]) => name.toLowerCase() === 'user-agent')?.[1];
  return ['-protocol_whitelist', 'http,https,tcp,tls,httpproxy', '-rw_timeout', '15000000',
    ...(ua ? ['-user_agent', ua] : []), ...(headers ? ['-headers', headers] : [])];
}

export class MediaStore {
  sources = new Map();
  jobs = new Jobs();
  secret = randomBytes(32);
  audioStreams = new Set();
  constructor({ upstream, cacheDir = '/cache', ffmpeg = 'ffmpeg', ffprobe = 'ffprobe' }) {
    this.upstream = new URL(upstream);
    this.cacheDir = path.resolve(cacheDir);
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe;
  }

  register(movie, requestHeaders = {}) {
    const base = movie?.base;
    if (!base || base.live || base.rtmpSource || !['alist', 'emby'].includes(base.vendorInfo?.vendor)) return;
    const raw = base.moreSources?.find(source => source.name === 'raw');
    const readable = source => source?.url && !/^(m3u8|mpd|flv|rtmp)$/i.test(source.type || '') && !/\.(m3u8|mpd)(\?|$)/i.test(source.url);
    const media = [raw, base, ...(base.moreSources || [])].find(readable);
    if (!media) return;
    let url;
    try { url = new URL(media.url, this.upstream); } catch { return; }
    if (!['http:', 'https:'].includes(url.protocol)) return;
    const headers = {};
    for (const [name, value] of Object.entries(base.headers || {})) {
      if (/^[a-z0-9-]+$/i.test(name) && typeof value === 'string' && !/[\r\n]/.test(value)) headers[name] = value;
    }
    if (!Object.keys(headers).some(name => name.toLowerCase() === 'user-agent')) {
      headers['User-Agent'] = requestHeaders['user-agent'] || 'Mozilla/5.0';
    }
    if (url.origin === this.upstream.origin && url.pathname.startsWith('/api/')) {
      for (const name of ['authorization', 'x-room-id']) {
        if (requestHeaders[name]) headers[name] = requestHeaders[name];
      }
    }
    const proxyIdentity = url.origin === this.upstream.origin && url.pathname.startsWith('/api/room/movie/proxy/')
      ? JSON.stringify([movie.id, movie.subPath || '']) : '';
    const sourceIndex = media === base ? 0 : (base.moreSources || []).indexOf(media) + 1;
    const fingerprint = JSON.stringify([url.href, headers, proxyIdentity, sourceIndex]);
    const key = createHash('sha256').update(this.secret).update(fingerprint).digest('hex');
    let expires = Date.now() + ttl;
    // The upstream has already authenticated this request. Limit the new capability
    // to that same session's remaining lifetime, when the JWT includes an expiry.
    try {
      const token = (requestHeaders.authorization || '').replace(/^Bearer /i, '');
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      if (Number.isFinite(payload.exp)) expires = Math.min(expires, payload.exp * 1000);
    } catch { /* The upstream also supports non-JWT credentials. */ }
    let source = this.sources.get(key);
    if (!source) {
      const cacheKey = createHash('sha256').update(fingerprint).digest('hex');
      source = { key, url: url.href, headers, dir: path.join(this.cacheDir, cacheKey), tracks: null,
        pendingTracks: null, pendingFiles: new Map(), attachments: [], expires, busy: 0,
        sourceIndex };
      this.sources.set(key, source);
    }
    source.expires = expires;
    source.touched = Date.now();
    for (const [id, item] of this.sources) {
      if (!item.busy && (item.expires < Date.now() || (this.sources.size > 128 && id !== key))) this.sources.delete(id);
    }
    return `/_synctv/subtitles/${key}/tracks`;
  }

  get(key) {
    const source = this.sources.get(key);
    if (!source || source.expires < Date.now()) return;
    source.touched = Date.now();
    return source;
  }

  async tracks(source) {
    if (source.tracks) return source.tracks;
    if (!source.pendingTracks) {
      source.busy++;
      source.pendingTracks = this.jobs.run(async () => {
        const output = await run(this.ffprobe, ['-v', 'error', ...inputArgs(source),
          '-probesize', '5242880', '-analyzeduration', '5000000',
          '-show_entries', 'format=format_name,duration:stream=index,codec_name,codec_type,profile,width,height,pix_fmt,bits_per_raw_sample,avg_frame_rate,r_frame_rate,bit_rate,color_space,color_transfer,color_primaries,channels,channel_layout,sample_rate:stream_side_data:stream_tags=language,title,filename,mimetype:stream_disposition=default,forced,attached_pic',
          '-of', 'json', source.url]);
        const probe = JSON.parse(output.toString());
        const streams = probe.streams || [];
        source.audioTracks = audioInfo(probe).map(track => ({ ...track,
          url: `/_synctv/subtitles/${source.key}/audio-${track.index}.mp4` }));
        source.duration = Number(probe.format?.duration) || undefined;
        source.info = { video: videoInfo(probe), audioTracks: source.audioTracks,
          container: probe.format?.format_name, sourceIndex: source.sourceIndex };
        source.attachments = streams.filter(stream => stream.codec_type === 'attachment' &&
          (/^(ttf|otf)$/.test(stream.codec_name || '') || /\.(ttf|otf)$/i.test(stream.tags?.filename || ''))).slice(0, 16);
        const fonts = source.attachments.map(stream => `/_synctv/subtitles/${source.key}/font-${stream.index}`);
        source.tracks = streams.filter(stream => stream.codec_type === 'subtitle' && codecs[stream.codec_name]).map(stream => {
          const type = codecs[stream.codec_name];
          const language = stream.tags?.language || '';
          const title = stream.tags?.title || language || `字幕 ${stream.index}`;
          return { index: stream.index, type, language, title,
            default: !!stream.disposition?.default, forced: !!stream.disposition?.forced,
            url: `/_synctv/subtitles/${source.key}/track-${stream.index}.${type}`,
            fonts: type === 'ass' ? fonts : [] };
        });
        return source.tracks;
      }).finally(() => { source.pendingTracks = null; source.busy--; });
    }
    return source.pendingTracks;
  }

  async file(source, index, type) {
    const tracks = await this.tracks(source);
    const track = tracks.find(track => track.index === index && track.type === type);
    if (!track) throw new Error('字幕轨道不存在');
    const file = path.join(source.dir, `track-${index}.${type}`);
    if (await this.validFile(file, maxSubtitle)) return file;
    if (!source.pendingFiles.has(index)) {
      source.busy++;
      const pending = this.jobs.run(async () => {
        await mkdir(source.dir, { recursive: true });
        const staging = await mkdtemp(path.join(source.dir, '.job-'));
        try {
          const destination = path.join(staging, `track.${type}`);
          const fonts = type === 'ass' ? source.attachments : [];
          const attachments = fonts.flatMap(font => [`-dump_attachment:${font.index}`, path.join(staging, `font-${font.index}`)]);
          const muxer = type === 'vtt' ? 'webvtt' : type;
          await run(this.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
            ...inputArgs(source), ...attachments, '-i', source.url, '-map', `0:${index}`, '-vn', '-an',
            '-c:s', type === 'ass' ? 'ass' : type === 'srt' ? 'srt' : 'webvtt',
            '-f', muxer, '-fs', String(maxSubtitle), destination], { timeout: 300000, limit: 1024 });
          const content = await readFile(destination);
          if (content.length >= maxSubtitle) throw new Error('字幕超过大小限制');
          if (type === 'ass' && !content.includes(Buffer.from('[Events]'))) throw new Error('ASS 字幕内容无效');
          for (const font of fonts) {
            const candidate = path.join(staging, `font-${font.index}`);
            if (await this.validFile(candidate, maxFont)) await rename(candidate, path.join(source.dir, `font-${font.index}`));
          }
          await rename(destination, file);
          return file;
        } finally { await rm(staging, { recursive: true, force: true }); }
      }).finally(() => { source.pendingFiles.delete(index); source.busy--; });
      source.pendingFiles.set(index, pending);
    }
    return source.pendingFiles.get(index);
  }

  streamAudio(source, index, start, rate, req, res) {
    if (!source.audioTracks?.some(track => track.index === index)) throw new Error('音轨不存在');
    if (this.audioStreams.size >= 8) throw new Error('兼容音频连接已满，请稍后重试');
    source.busy++;
    // Only audio is mapped. The original video URL and encoded video are untouched.
    const child = spawn(this.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error',
      ...inputArgs(source), '-ss', String(start), '-readrate', String(Math.max(3, rate * 1.25)), '-i', source.url,
      '-map', `0:${index}`, '-vn', '-sn', '-dn', '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k',
      '-threads', '1', '-af', 'asetpts=PTS-STARTPTS', '-movflags', 'empty_moov+frag_keyframe+default_base_moof',
      '-frag_duration', '500000', '-f', 'mp4', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.audioStreams.add(child);
    res.writeHead(200, { 'Content-Type': 'audio/mp4', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' });
    const kill = () => { if (child.exitCode === null) child.kill('SIGKILL'); };
    const startup = setTimeout(() => { kill(); res.destroy(); }, 30000);
    const expiry = setTimeout(() => { kill(); res.destroy(); }, Math.max(1, source.expires - Date.now()));
    child.stdout.once('data', () => clearTimeout(startup));
    child.stderr.resume();
    child.once('error', () => res.destroy());
    child.once('close', code => {
      clearTimeout(startup); clearTimeout(expiry);
      source.busy--; this.audioStreams.delete(child);
      res.off('close', kill); req.off('aborted', kill);
      if (code !== 0) res.destroy();
    });
    req.once('aborted', kill); res.once('close', kill);
    child.stdout.pipe(res);
  }

  async font(source, index) {
    const tracks = await this.tracks(source);
    if (!source.attachments.some(font => font.index === index)) throw new Error('字体不存在');
    const file = path.join(source.dir, `font-${index}`);
    if (!await this.validFile(file, maxFont)) {
      const ass = tracks.find(track => track.type === 'ass');
      if (!ass) throw new Error('字体不存在');
      await this.file(source, ass.index, ass.type);
    }
    if (!await this.validFile(file, maxFont)) throw new Error('无法读取内封字体');
    return file;
  }

  async validFile(file, limit) {
    try {
      const info = await stat(file);
      return info.isFile() && info.size < limit && info.mtimeMs > Date.now() - ttl;
    } catch { return false; }
  }

  async prune() {
    await mkdir(this.cacheDir, { recursive: true });
    const protectedDirs = new Set([...this.sources.values()].filter(source => source.busy).map(source => source.dir));
    const entries = [];
    for (const entry of await readdir(this.cacheDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
      const dir = path.join(this.cacheDir, entry.name);
      if (protectedDirs.has(dir)) continue;
      let size = 0, newest = 0;
      for (const child of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, child.name);
        const info = await stat(file).catch(() => null);
        if (!info) continue;
        newest = Math.max(newest, info.mtimeMs);
        if (child.isFile()) size += info.size;
        else if (child.isDirectory() && child.name.startsWith('.job-') && info.mtimeMs < Date.now() - ttl) {
          await rm(file, { recursive: true, force: true });
        }
      }
      entries.push({ dir, size, newest });
    }
    entries.sort((a, b) => b.newest - a.newest);
    let total = 0;
    for (const entry of entries) {
      total += entry.size;
      if (entry.newest < Date.now() - ttl || total > 512 * 1024 * 1024) await rm(entry.dir, { recursive: true, force: true });
    }
  }
}
