import Artplayer from "artplayer";
import type { BaseMovieInfo } from "@/types/Movie";
import { audioCorrection, audioLabel, audioMime, type EmbeddedAudioTrack } from "@/utils/audio";
import "./audio.css";
import {controlIcon,icon} from './icons';
import {trackLabel,escapeLabel} from '@/utils/track-label';

const mseMime = 'audio/mp4; codecs="mp4a.40.2"';

function ranges(list?: TimeRanges): [number, number][] {
  if (!list) return [];
  return Array.from({ length: list.length }, (_, i) => [list.start(i), list.end(i)]);
}

function canUseMse() {
  return (
    typeof MediaSource !== "undefined" &&
    typeof MediaSource.isTypeSupported === "function" &&
    MediaSource.isTypeSupported(mseMime) &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function"
  );
}

function waitForEvent(target: EventTarget, event: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const onEvent = () => { signal.removeEventListener("abort", onAbort); resolve(); };
    const onAbort = () => { target.removeEventListener(event, onEvent); reject(new DOMException("Aborted", "AbortError")); };
    target.addEventListener(event, onEvent, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function waitMs(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const onAbort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function artplayerEmbeddedAudio(initialContext: BaseMovieInfo) {
  return (art: Artplayer) => {
    let context = initialContext;
    let tracks: EmbeddedAudioTrack[] = [];
    let sourceDuration: number | undefined;
    let selected: EmbeddedAudioTrack | undefined;
    let disposed = false,
      origin = 0,
      startedAt = 0,
      readyAt = 0,
      lastSeekAt = 0,
      generation = 0,
      streamRate = 1,
      leadRetries = 0,
      playBlocked = false,
      aligning = false;
    let discovery: AbortController | undefined;
    let streamAbort: AbortController | undefined;
    let objectUrl: string | undefined;
    let pauseTimer: ReturnType<typeof setTimeout> | undefined;
    let playAttempt: Promise<void> | undefined;
    const video = art.video;
    const audio = document.createElement("audio");
    audio.preload = "auto";
    audio.hidden = true;
    audio.dataset.synctvAudio = "compat";
    art.template.$container.append(audio);
    const nativeMuted = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "muted")!;
    let originalMuted: PropertyDescriptor | undefined;
    let logicalMuted = video.muted;
    let routed = false;
    const remove = (name: string) => {
      if (art.controls[name]) art.controls.remove(name);
      if (art.setting.find(name)) art.setting.remove(name);
    };
    const stopStream = () => {
      generation++;
      playAttempt = undefined;
      readyAt = 0;
      lastSeekAt = 0;
      aligning = false;
      streamAbort?.abort();
      streamAbort = undefined;
      audio.pause(); audio.removeAttribute("src"); audio.load();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = undefined;
      }
    };
    const restore = () => {
      stopStream();
      leadRetries = 0;
      clearTimeout(pauseTimer);
      if (routed) {
        if (originalMuted) Object.defineProperty(video, "muted", originalMuted);
        else delete (video as any).muted;
        nativeMuted.set!.call(video, logicalMuted);
        routed = false;
      }
      remove("audio-start");
    };
    const volume = () => { audio.volume = video.volume; audio.muted = aligning || video.muted; };
    const routeAudio = () => {
      if (routed) return;
      logicalMuted = video.muted;
      originalMuted = Object.getOwnPropertyDescriptor(video, "muted");
      // Keep Artplayer's mute/volume controls truthful while silencing the original
      // audio renderer. The video element and its HDR rendering path stay intact.
      Object.defineProperty(video, "muted", { configurable: true, get: () => logicalMuted,
        set: (value: boolean) => {
          logicalMuted = !!value; audio.muted = aligning || logicalMuted;
          nativeMuted.set!.call(video, true);
          video.dispatchEvent(new Event("volumechange"));
        } });
      routed = true;
      nativeMuted.set!.call(video, true);
      volume();
    };
    const play = () => {
      if (disposed || !selected || playBlocked || playAttempt || video.paused || !audio.getAttribute("src")) return;
      const current = generation;
      const attempt = audio.play().then(() => { if (current === generation) remove("audio-start"); }).catch((error) => {
        if (disposed || current !== generation) return;
        if (error.name !== 'NotAllowedError') return;
        playBlocked = true;
        art.setting.update({ name: "audio-start", html: "开启声音", icon: icon("audio"), onClick: () => { playBlocked = false; play(); return ""; } });
        art.notice.show = "浏览器阻止了声音自动播放，请在设置中点击“开启声音”";
      }).finally(() => { if (playAttempt === attempt) playAttempt = undefined; });
      playAttempt = attempt;
    };
    const pumpMse = async (url: string, current: number, abort: AbortController) => {
      const ms = new MediaSource();
      const blobUrl = URL.createObjectURL(ms);
      objectUrl = blobUrl;
      const responsePromise = fetch(url, { signal: abort.signal });
      audio.src = blobUrl;
      try {
        if (ms.readyState !== "open") await waitForEvent(ms, "sourceopen", abort.signal);
        if (disposed || current !== generation || abort.signal.aborted) return;
        const sb = ms.addSourceBuffer(mseMime);
        try { sb.mode = "segments"; } catch { /* default mode */ }
        const response = await responsePromise;
        if (disposed || current !== generation || abort.signal.aborted) return;
        if (!response.ok || !response.body) throw new Error("Audio stream failed");
        const reader = response.body.getReader();
        try {
          while (!disposed && current === generation && !abort.signal.aborted) {
            // Backpressure when buffered well ahead (e.g. during pause) to keep memory bounded.
            while (!disposed && current === generation && !abort.signal.aborted) {
              const buf = ranges(audio.buffered);
              const end = buf.length ? buf[buf.length - 1][1] : 0;
              if (end - audio.currentTime <= 45) break;
              await waitMs(250, abort.signal);
            }
            const { done, value } = await reader.read();
            if (disposed || current !== generation || abort.signal.aborted) return;
            if (done) {
              if (sb.updating) await waitForEvent(sb, "updateend", abort.signal);
              if (ms.readyState === "open") ms.endOfStream();
              return;
            }
            if (!value || !value.byteLength) continue;
            if (sb.updating) await waitForEvent(sb, "updateend", abort.signal);
            const buf = ranges(audio.buffered);
            if (buf.length && audio.currentTime - buf[0][0] > 40) {
              const removeEnd = Math.max(buf[0][0], audio.currentTime - 25);
              if (removeEnd > buf[0][0] + 1) {
                sb.remove(buf[0][0], removeEnd);
                await waitForEvent(sb, "updateend", abort.signal);
              }
            }
            try {
              sb.appendBuffer(value);
            } catch (error: any) {
              if (error?.name !== "QuotaExceededError") throw error;
              const currentBuf = ranges(audio.buffered);
              if (currentBuf.length) {
                const trimEnd = Math.max(currentBuf[0][0], audio.currentTime - 5);
                if (trimEnd > currentBuf[0][0] + 0.5) {
                  sb.remove(currentBuf[0][0], trimEnd);
                  await waitForEvent(sb, "updateend", abort.signal);
                }
              }
              sb.appendBuffer(value);
            }
            if (sb.updating) await waitForEvent(sb, "updateend", abort.signal);
            if (aligning || audio.paused) sync();
          }
        } finally {
          reader.cancel().catch(() => {});
        }
      } catch {
        if (disposed || current !== generation || abort.signal.aborted) return;
        if (ms.readyState === "open") {
          try { ms.endOfStream("network"); } catch { /* ignore */ }
        }
        art.notice.show = "兼容音轨读取失败，请在音轨菜单重新选择";
      }
    };
    const begin = (lead = 0) => {
      if (disposed || !selected) return;
      stopStream();
      if (lead === 0) leadRetries = 0;
      playBlocked = false;
      aligning = true;
      routeAudio();
      const target = Math.max(0, video.currentTime + lead);
      origin = sourceDuration && sourceDuration > 1 ? Math.min(target, Math.max(0, sourceDuration - 0.5)) : target;
      startedAt = Date.now();
      streamRate = Math.max(0.5, Math.min(5, video.playbackRate));
      const url = new URL(selected.url, window.location.origin);
      url.searchParams.set("start", origin.toFixed(3));
      url.searchParams.set("rate", String(streamRate));
      audio.playbackRate = video.playbackRate;
      volume();
      if (canUseMse()) {
        const abort = (streamAbort = new AbortController());
        void pumpMse(url.href, generation, abort);
      } else {
        audio.src = url.href;
        if (lead > 0) audio.load();
      }
      if (lead === 0) play();
    };
    const sync = () => {
      if (disposed || !selected) return;
      if (video.paused || video.seeking || video.readyState < 3) { audio.pause(); return; }
      if (!audio.getAttribute("src")) { begin(); return; }
      // An empty/initially buffering audio element has no playable timeline yet.
      // Restarting it every few seconds can prevent a slow NAS from ever loading.
      if (audio.readyState < 3 || playAttempt) return;
      if (!readyAt) readyAt = Date.now();
      const rawExpected = video.currentTime - origin;
      // When a lead-compensated stream arrives slightly ahead of video, wait silently at 0 until video catches up.
      if (rawExpected < -0.05) {
        if (rawExpected < -8) { begin(); return; }
        audio.pause();
        if (audio.currentTime > 0.05) {
          const valid = ranges(audio.seekable);
          if (valid.some(([start, end]) => 0 >= start && 0 < end - 0.05)) audio.currentTime = 0;
        }
        return;
      }
      const correction = audioCorrection(video.currentTime, audio.currentTime, origin, video.playbackRate);
      const absDrift = Math.abs(correction.drift);
      const now = Date.now();
      const seekable = ranges(audio.seekable);
      const buffered = ranges(audio.buffered);
      const canSeekTo = (target: number) =>
        seekable.some(([start, end]) => target >= start && target < end - 0.05) ||
        (!!objectUrl && buffered.some(([start, end]) => target >= start && target < end - 0.05));
      if (absDrift > 0.18) {
        if (canSeekTo(correction.expected)) {
          if (now - lastSeekAt > 350) {
            audio.currentTime = correction.expected;
            lastSeekAt = now;
          }
          audio.playbackRate = video.playbackRate;
          if (aligning) { aligning = false; volume(); }
          if (audio.paused) play();
          return;
        }
        // Right after startup, hold audio silently while the initial burst catches up to video time.
        if (aligning && now - readyAt < 2500) {
          audio.pause();
          return;
        }
        // On slow links without seekable range ahead, reopen with lead compensation so FFmpeg lands at video time.
        if (absDrift > 1.2 && now - readyAt >= 2500 && now - startedAt > 5000 && leadRetries < 3) {
          const startupSec = Math.max(1, (readyAt - startedAt) / 1000);
          const lead = correction.drift > 0 ? Math.min(6, Math.max(1.5, startupSec * 0.85)) : 0;
          leadRetries++;
          begin(lead);
          return;
        }
      }
      if (aligning) { aligning = false; volume(); }
      audio.playbackRate = Math.max(0.25, Math.min(5, correction.rate));
      if (audio.paused) play();
    };
    const select = (track?: EmbeddedAudioTrack) => {
      restore(); selected = track;
      if (track) { routeAudio(); if (!video.paused) begin(); }
      update();
    };
    const currentIsOriginal = () => {
      if (!/^(mkv|mp4|m4v|mov|webm)$/i.test(art.option.type || context.type)) return false;
      const current = art.plugins?.source?.currentSource?.();
      return !current || current.html === "默认" || current.html === "raw" || current.playbackMode === "direct";
    };
    const update = () => {
      if (disposed || !tracks.length || !currentIsOriginal()) {
        if (selected) { restore(); selected = undefined; }
        remove("audio-embedded"); return;
      }
      const selector = [
        { html: "原声自动", index: -1, default: !selected },
        ...tracks.map(track => {
          const label = document.createElement("span");
          label.textContent = `${trackLabel({...track,origin:'embedded'},`音轨 ${track.index}`)} · AAC 兼容`;
          return { html: label.innerHTML, index: track.index, default: selected?.index === track.index };
        })
      ];
      const onSelect = (item: any) => { select(tracks.find(track => track.index === item.index)); return controlIcon('audio','音轨'); };
      if (art.controls["audio-embedded"]) art.controls.remove("audio-embedded");
      art.setting.update({ name: "audio-embedded", html: "音轨",icon:icon('audio'), selector, onSelect:(item:any)=>{onSelect(item);return item.index<0?'原声自动':'AAC 兼容';}, width: 420 });
    };
    const discover = async () => {
      discovery?.abort();
      const controller = discovery = new AbortController();
      if (!context.embeddedSubtitleSource) return;
      try {
        const response = await fetch(context.embeddedSubtitleSource, { signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json();
        if (disposed || controller.signal.aborted) return;
        tracks = result.audioTracks || [];
        sourceDuration = Number.isFinite(Number(result.duration)) && Number(result.duration) > 0 ? Number(result.duration) : undefined;
        update();
        const preferred = tracks.find(track => track.default) || tracks[0];
        const mime = preferred && audioMime(preferred.codec);
        if (preferred && currentIsOriginal() && (!mime || !video.canPlayType(mime))) select(preferred);
      } catch { /* Subtitle discovery already reports source/probe failures. */ }
    };
    audio.addEventListener("canplay", sync);
    audio.addEventListener("error", () => {
      if (!disposed && selected && audio.getAttribute("src")) art.notice.show = "兼容音轨读取失败，请在音轨菜单重新选择";
    });
    art.on("video:volumechange", volume);
    art.on("video:playing", () => { clearTimeout(pauseTimer); sync(); });
    art.on("video:pause", () => { audio.pause(); clearTimeout(pauseTimer); pauseTimer = setTimeout(stopStream, 10000); });
    art.on("video:waiting", () => audio.pause());
    art.on("video:seeking", stopStream);
    art.on("video:seeked", () => { if (selected && !video.paused) begin(); });
    art.on("video:ratechange", () => {
      if (!selected || video.paused) return;
      if (video.playbackRate > streamRate * 1.05) begin();
      else sync();
    });
    art.on("video:ended", stopStream);
    art.on("restart", () => { update(); if (selected && !video.paused) begin(); });
    art.on("fullscreen", update);
    const timer = setInterval(sync, 150);
    art.on("destroy", () => {
      disposed = true; discovery?.abort(); clearInterval(timer); restore(); audio.remove();
    });
    void discover();
    return { name: "audioCompat", status: () => selected ? `${audioLabel(selected)} → AAC 立体声` : "原声（浏览器解码）",
      info:()=>({transcoded:!!selected,codec:selected?'AAC':(tracks.find(t=>t.default)||tracks[0])?.codec?.toUpperCase(),channels:selected?2:(tracks.find(t=>t.default)||tracks[0])?.channels}),
      updateContext: (next: BaseMovieInfo) => { restore(); selected = undefined; tracks = []; sourceDuration = undefined; context = next; void discover(); } };
  };
}
