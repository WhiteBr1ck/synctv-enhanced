import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { videoInfo, audioInfo } from './video-info.mjs';

const codecs = { ass: 'ass', ssa: 'ass', subrip: 'srt', srt: 'srt', mov_text: 'srt', text: 'srt', webvtt: 'vtt' };
const maxSubtitle = 15 * 1024 * 1024;
const maxFont = 20 * 1024 * 1024;
const ttl = 6 * 60 * 60 * 1000;

function parseCueTime(value) {
  const parts = value.replace(',', '.').split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function extractPartial(raw, type) {
  if (!raw || !raw.length || raw.length >= maxSubtitle) return null;
  const text = raw.toString('utf8').replace(/\r\n?/g, '\n');
  if (type === 'ass') {
    if (!text.includes('[Events]')) return null;
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline < 0) return null;
    const body = text.slice(0, lastNewline + 1);
    let covered = 0, count = 0;
    for (const match of body.matchAll(/^Dialogue:[^,]*,[^,]*,(\d+:\d{2}:\d{2}\.\d{1,3}),/gm)) {
      count++;
      const end = parseCueTime(match[1]);
      if (Number.isFinite(end) && end > covered) covered = end;
    }
    return count > 0 ? { body, covered } : null;
  }
  const lastBreak = text.lastIndexOf('\n\n');
  if (lastBreak < 0) return null;
  const body = text.slice(0, lastBreak + 2);
  let covered = 0, count = 0;
  for (const match of body.matchAll(/(?:\d+:)?\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*((?:\d+:)?\d{2}:\d{2}[,.]\d{1,3})/g)) {
    count++;
    const end = parseCueTime(match[1]);
    if (Number.isFinite(end) && end > covered) covered = end;
  }
  return count > 0 ? { body, covered } : null;
}

class Jobs {
  active = 0;
  waiting = [];
  constructor(maxActive = 2, maxWaiting = 12) {
    this.maxActive = maxActive;
    this.maxWaiting = maxWaiting;
  }
  async run(task) {
    if (this.active >= this.maxActive) {
      if (this.waiting.length >= this.maxWaiting) throw new Error('字幕处理繁忙，请稍后重试');
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

function run(binary, args, { timeout = 25000, limit = 2 * 1024 * 1024, children } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    children?.add(child);
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
    child.once('error', () => { clearTimeout(timer); children?.delete(child); reject(new Error('字幕解析程序无法启动')); });
    child.once('close', code => {
      clearTimeout(timer);
      children?.delete(child);
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
  sliceJobs = new Jobs(2, 6);
  secret = randomBytes(32);
  audioStreams = new Set();
  children = new Set();
  constructor({ upstream, cacheDir = '/cache', ffmpeg = 'ffmpeg', ffprobe = 'ffprobe' }) {
    this.upstream = new URL(upstream);
    this.cacheDir = path.resolve(cacheDir);
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe;
  }

  close() {
    for (const child of this.audioStreams) child.kill('SIGKILL');
    for (const child of this.children) child.kill('SIGKILL');
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
        pendingTracks: null, pendingBatch: null, pendingFiles: new Map(), liveFiles: new Map(), slices: new Map(),
        attachments: [], expires, busy: 0, sourceIndex, formatStart: 0 };
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
          '-show_entries', 'format=format_name,duration,start_time:stream=index,codec_name,codec_type,start_time,profile,width,height,pix_fmt,bits_per_raw_sample,avg_frame_rate,r_frame_rate,bit_rate,color_space,color_transfer,color_primaries,channels,channel_layout,sample_rate:stream_side_data:stream_tags=language,title,filename,mimetype:stream_disposition=default,forced,attached_pic',
          '-of', 'json', source.url], { children: this.children });
        const probe = JSON.parse(output.toString());
        const streams = probe.streams || [];
        source.audioTracks = audioInfo(probe).map(track => ({ ...track,
          url: `/_synctv/subtitles/${source.key}/audio-${track.index}.mp4` }));
        source.duration = Number(probe.format?.duration) || undefined;
        source.formatStart = Number.isFinite(Number(probe.format?.start_time)) ? Number(probe.format.start_time) : 0;
        source.info = { video: videoInfo(probe), audioTracks: source.audioTracks,
          container: probe.format?.format_name, sourceIndex: source.sourceIndex };
        source.attachments = streams.filter(stream => stream.codec_type === 'attachment' &&
          (/^(ttf|otf)$/.test(stream.codec_name || '') || /\.(ttf|otf)$/i.test(stream.tags?.filename || ''))).slice(0, 64);
        const fonts = source.attachments.map(stream => `/_synctv/subtitles/${source.key}/font-${stream.index}`);
        const fontFiles = source.attachments.map(stream => ({ name: stream.tags?.filename || "" }));
        source.tracks = streams.filter(stream => stream.codec_type === 'subtitle' && codecs[stream.codec_name]).map(stream => {
          const type = codecs[stream.codec_name];
          const language = stream.tags?.language || '';
          const title = stream.tags?.title || language || `字幕 ${stream.index}`;
          return { index: stream.index, type, language, title,
            default: !!stream.disposition?.default, forced: !!stream.disposition?.forced,
            url: `/_synctv/subtitles/${source.key}/track-${stream.index}.${type}`,
            fonts: type === 'ass' ? fonts : [], fontFiles: type === 'ass' ? fontFiles : [] };
        });
        return source.tracks;
      }).finally(() => { source.pendingTracks = null; source.busy--; });
    }
    return source.pendingTracks;
  }

  async extractTargets(source, targets) {
    await mkdir(source.dir, { recursive: true });
    const staging = await mkdtemp(path.join(source.dir, '.job-'));
    const staged = [];
    try {
      const timeout = Math.max(300000, Math.min(1800000, Math.ceil(((source.duration || 0) / 4 + 120) * 1000)));
      // Burst the opening 45s at full speed so initial subtitles appear within seconds,
      // then pace background scanning so video and compatibility audio are not starved.
      const rateArgs = source.duration && source.duration > 60
        ? ['-readrate', '6', '-readrate_initial_burst', '45']
        : [];
      const outputArgs = [];
      for (const item of targets) {
        const destination = path.join(staging, `track-${item.index}.${item.type}`);
        const muxer = item.type === 'vtt' ? 'webvtt' : item.type;
        const codec = item.type === 'ass' ? 'ass' : item.type === 'srt' ? 'srt' : 'webvtt';
        staged.push({ item, destination });
        source.liveFiles.set(item.index, { path: destination, type: item.type });
        outputArgs.push('-map', `0:${item.index}`, '-vn', '-an', '-c:s', codec,
          '-flush_packets', '1', '-f', muxer, '-fs', String(maxSubtitle), destination);
      }
      await run(this.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        ...inputArgs(source), ...rateArgs, '-threads', '1', '-i', source.url, ...outputArgs],
        { timeout, limit: 1024, children: this.children });
      for (const { item, destination } of staged) {
        const content = await readFile(destination).catch(() => null);
        if (!content || content.length >= maxSubtitle) {
          if (targets.length === 1) throw new Error('字幕超过大小限制');
          continue;
        }
        if (item.type === 'ass' && !content.includes(Buffer.from('[Events]'))) {
          if (targets.length === 1) throw new Error('ASS 字幕内容无效');
          continue;
        }
        await rename(destination, path.join(source.dir, `track-${item.index}.${item.type}`));
        source.liveFiles.delete(item.index);
      }
      source.slices.clear();
    } finally {
      for (const { item } of staged) source.liveFiles.delete(item.index);
      await rm(staging, { recursive: true, force: true });
    }
  }

  async file(source, index, type) {
    const tracks = await this.tracks(source);
    const track = tracks.find(track => track.index === index && track.type === type);
    if (!track) throw new Error('字幕轨道不存在');
    const file = path.join(source.dir, `track-${index}.${type}`);
    if (await this.validFile(file, maxSubtitle)) return file;
    if (!source.pendingFiles.has(index)) {
      source.busy++;
      const pending = (async () => {
        // Extract all uncached embedded text tracks in one HTTP scan pass so switching
        // tracks does not re-download a multi-gigabyte MKV over the network.
        if (!source.pendingBatch) {
          const batchTargets = [];
          for (const candidate of tracks.slice(0, 64)) {
            const candidateFile = path.join(source.dir, `track-${candidate.index}.${candidate.type}`);
            if (!await this.validFile(candidateFile, maxSubtitle)) batchTargets.push(candidate);
          }
          if (!batchTargets.some(candidate => candidate.index === track.index)) batchTargets.push(track);
          source.busy++;
          source.pendingBatch = this.jobs.run(() => this.extractTargets(source, batchTargets))
            .finally(() => { source.pendingBatch = null; source.busy--; });
        }
        let batchError;
        try { await source.pendingBatch; }
        catch (error) { batchError = error; }
        if (await this.validFile(file, maxSubtitle)) return file;
        // If a multi-track pass failed because of an unrelated malformed track, retry just this track.
        if (tracks.length > 1) {
          await this.jobs.run(() => this.extractTargets(source, [track]));
          if (await this.validFile(file, maxSubtitle)) return file;
        }
        throw batchError || new Error('无法读取该视频的内封字幕');
      })().finally(() => { source.pendingFiles.delete(index); source.busy--; });
      source.pendingFiles.set(index, pending);
    }
    return source.pendingFiles.get(index);
  }

  async extractSlice(source, index, type, at) {
    const bucket = Math.floor(at / 60);
    const sliceKey = `${index}:${type}:${bucket}`;
    if (source.slices.has(sliceKey)) return source.slices.get(sliceKey);
    const start = Math.max(0, Math.floor(at) - 5);
    const end = (source.formatStart || 0) + Math.floor(at) + 120;
    const muxer = type === 'vtt' ? 'webvtt' : type;
    const codec = type === 'ass' ? 'ass' : type === 'srt' ? 'srt' : 'webvtt';
    source.busy++;
    const promise = this.sliceJobs.run(async () => {
      const output = await run(this.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error',
        ...inputArgs(source), '-ss', String(start), '-copyts', '-threads', '1', '-i', source.url,
        '-map', `0:${index}`, '-vn', '-an', '-to', String(end), '-c:s', codec, '-f', muxer, 'pipe:1'],
        { timeout: 25000, limit: maxSubtitle, children: this.children });
      const text = output.toString('utf8').replace(/\r\n?/g, '\n');
      const normalized = type === 'ass' ? (text.endsWith('\n') ? text : text + '\n') : (text.endsWith('\n\n') ? text : text.trimEnd() + '\n\n');
      return extractPartial(Buffer.from(normalized, 'utf8'), type);
    }).catch(() => null).finally(() => { source.busy--; });
    source.slices.set(sliceKey, promise);
    const result = await promise;
    if (!result) source.slices.delete(sliceKey);
    return result;
  }

  async readPartial(source, index, type, at = 0) {
    const live = source.liveFiles?.get(index);
    let partial = null;
    if (live && live.type === type) {
      const raw = await readFile(live.path).catch(() => null);
      partial = extractPartial(raw, type);
    }
    if (partial && (!at || at < 20 || partial.covered >= at)) return partial;
    if (at >= 20 && source.tracks?.some(track => track.index === index && track.type === type)) {
      const sliced = await this.extractSlice(source, index, type, at);
      if (sliced) {
        if (partial && type !== 'ass') {
          return { body: `${partial.body}\n${sliced.body}`, covered: Math.max(partial.covered, sliced.covered) };
        }
        return sliced;
      }
    }
    return partial;
  }

  async prepareFile(source, index, type, retry = false) {
    source.fileJobs ||= new Map();
    let job = source.fileJobs.get(index);
    if (job && ((retry && job.error) || (job.file && !await this.validFile(job.file, maxSubtitle)))) {
      source.fileJobs.delete(index);
      job = undefined;
    }
    if (!job) {
      job = {};
      source.fileJobs.set(index, job);
      // Keep completion and failure available across short polling requests.
      // A failed extraction only restarts when the viewer explicitly retries.
      job.promise = this.file(source, index, type).then(file => { job.file = file; }, error => { job.error = error; });
    }
    return job;
  }

  streamAudio(source, index, start, rate, req, res) {
    if (!source.audioTracks?.some(track => track.index === index)) throw new Error('音轨不存在');
    if (this.audioStreams.size >= 8) throw new Error('兼容音频连接已满，请稍后重试');
    source.busy++;
    // Only audio is mapped. The original video URL and encoded video are untouched.
    // aresample=async=1:first_pts=0 preserves non-zero MKV stream start_time offsets
    // instead of shifting delayed audio tracks back to 0.000s like asetpts=PTS-STARTPTS.
    const readrate = Math.max(1.25, rate * 1.35);
    const child = spawn(this.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error',
      ...inputArgs(source), '-ss', String(start), '-readrate', String(readrate), '-readrate_initial_burst', '8', '-threads', '1', '-i', source.url,
      '-map', `0:${index}`, '-vn', '-sn', '-dn', '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k',
      '-threads', '1', '-af', 'aresample=async=1:first_pts=0', '-movflags', 'empty_moov+frag_keyframe+default_base_moof',
      '-frag_duration', '150000', '-flush_packets', '1', '-f', 'mp4', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
    await this.tracks(source);
    if (!source.attachments.some(font => font.index === index)) throw new Error('字体不存在');
    const file = path.join(source.dir, `font-${index}`);
    if (!await this.validFile(file, maxFont)) {
      if (!source.pendingFonts) {
        source.busy++;
        source.pendingFonts = this.jobs.run(async () => {
          await mkdir(source.dir, { recursive: true });
          const staging = await mkdtemp(path.join(source.dir, '.job-'));
          try {
            // Matroska font attachments are in its header. Stop before decoding
            // any video frames instead of scanning an entire episode's subtitle.
            const attachments = source.attachments.flatMap(font => [`-dump_attachment:${font.index}`, path.join(staging, `font-${font.index}`)]);
            await run(this.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
              ...inputArgs(source), ...attachments, '-i', source.url,
              '-map', '0:v:0', '-frames:v', '0', '-an', '-sn', '-f', 'null', '-'], { timeout: 45000, limit: 1024, children: this.children });
            for (const font of source.attachments) {
              const candidate = path.join(staging, `font-${font.index}`);
              if (await this.validFile(candidate, maxFont)) await rename(candidate, path.join(source.dir, `font-${font.index}`));
            }
          } finally { await rm(staging, { recursive: true, force: true }); }
        }).finally(() => { source.pendingFonts = null; source.busy--; });
      }
      await source.pendingFonts;
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
