import Artplayer from "artplayer";
import type { BaseMovieInfo } from "@/types/Movie";
import { audioCorrection, audioLabel, audioMime, type EmbeddedAudioTrack } from "@/utils/audio";
import "./audio.css";

export function artplayerEmbeddedAudio(initialContext: BaseMovieInfo) {
  return (art: Artplayer) => {
    let context = initialContext;
    let tracks: EmbeddedAudioTrack[] = [];
    let selected: EmbeddedAudioTrack | undefined;
    let disposed = false, origin = 0, startedAt = 0, generation = 0, playBlocked = false;
    let discovery: AbortController | undefined;
    let pauseTimer: ReturnType<typeof setTimeout> | undefined;
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
      audio.pause(); audio.removeAttribute("src"); audio.load();
    };
    const restore = () => {
      stopStream();
      clearTimeout(pauseTimer);
      if (routed) {
        if (originalMuted) Object.defineProperty(video, "muted", originalMuted);
        else delete (video as any).muted;
        nativeMuted.set!.call(video, logicalMuted);
        routed = false;
      }
      remove("audio-start");
    };
    const volume = () => { audio.volume = video.volume; audio.muted = video.muted; };
    const routeAudio = () => {
      if (routed) return;
      logicalMuted = video.muted;
      originalMuted = Object.getOwnPropertyDescriptor(video, "muted");
      // Keep Artplayer's mute/volume controls truthful while silencing the original
      // audio renderer. The video element and its HDR rendering path stay intact.
      Object.defineProperty(video, "muted", { configurable: true, get: () => logicalMuted,
        set: (value: boolean) => {
          logicalMuted = !!value; audio.muted = logicalMuted;
          nativeMuted.set!.call(video, true);
          video.dispatchEvent(new Event("volumechange"));
        } });
      routed = true;
      nativeMuted.set!.call(video, true);
      volume();
    };
    const play = () => {
      if (disposed || !selected || playBlocked || video.paused || !audio.getAttribute("src")) return;
      const current = generation;
      void audio.play().then(() => { if (current === generation) remove("audio-start"); }).catch(() => {
        if (disposed || current !== generation) return;
        playBlocked = true;
        art.controls.update({ name: "audio-start", position: "right", html: "开启声音", click: () => { playBlocked = false; play(); } });
        art.notice.show = "浏览器阻止了声音自动播放，请点击“开启声音”";
      });
    };
    const begin = () => {
      if (disposed || !selected) return;
      stopStream();
      playBlocked = false;
      routeAudio();
      origin = Math.max(0, video.currentTime);
      startedAt = Date.now();
      const url = new URL(selected.url, window.location.origin);
      url.searchParams.set("start", origin.toFixed(3));
      url.searchParams.set("rate", String(Math.max(0.5, Math.min(5, video.playbackRate))));
      audio.src = url.href;
      audio.playbackRate = video.playbackRate;
      volume();
      play();
    };
    const sync = () => {
      if (disposed || !selected) return;
      if (video.paused || video.seeking || video.readyState < 3) { audio.pause(); return; }
      if (!audio.getAttribute("src")) { begin(); return; }
      const correction = audioCorrection(video.currentTime, audio.currentTime, origin, video.playbackRate);
      if (Math.abs(correction.drift) > 0.35) {
        const seekable = Array.from({ length: audio.seekable.length }, (_, i) => [audio.seekable.start(i), audio.seekable.end(i)]);
        if (seekable.some(([start, end]) => correction.expected >= start && correction.expected < end - 0.05)) audio.currentTime = correction.expected;
        else if (Date.now() - startedAt > 5000 && Math.abs(correction.drift) > 1.5) { begin(); return; }
      }
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
      return !current || current.html === "默认" || current.html === "raw";
    };
    const update = () => {
      if (disposed || !tracks.length || !currentIsOriginal()) {
        if (selected) { restore(); selected = undefined; }
        remove("audio-embedded"); return;
      }
      const selector = [
        { html: "原声自动（浏览器解码）", index: -1, default: !selected },
        ...tracks.map(track => {
          const label = document.createElement("span");
          label.textContent = `${audioLabel(track)} · AAC兼容 [${track.index}]`;
          return { html: label.innerHTML, index: track.index, default: selected?.index === track.index };
        })
      ];
      const onSelect = (item: any) => { select(tracks.find(track => track.index === item.index)); return "音轨"; };
      if (!Artplayer.utils.isMobile || art.fullscreen) art.controls.update({ name: "audio-embedded", position: "right", html: "音轨", selector, onSelect });
      else if (art.controls["audio-embedded"]) art.controls.remove("audio-embedded");
      art.setting.update({ name: "audio-embedded", html: "音轨", selector, onSelect, width: 320 });
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
    art.on("video:pause", () => { audio.pause(); clearTimeout(pauseTimer); pauseTimer = setTimeout(stopStream, 15000); });
    art.on("video:waiting", () => audio.pause());
    art.on("video:seeking", stopStream);
    art.on("video:seeked", () => { if (selected && !video.paused) begin(); });
    art.on("video:ratechange", () => { if (selected && !video.paused) begin(); });
    art.on("video:ended", stopStream);
    art.on("restart", () => { update(); if (selected && !video.paused) begin(); });
    art.on("fullscreen", update);
    const timer = setInterval(sync, 250);
    art.on("destroy", () => {
      disposed = true; discovery?.abort(); clearInterval(timer); restore(); audio.remove();
    });
    void discover();
    return { name: "audioCompat", status: () => selected ? `${audioLabel(selected)} → AAC 立体声` : "原声（浏览器解码）",
      updateContext: (next: BaseMovieInfo) => { restore(); selected = undefined; tracks = []; context = next; void discover(); } };
  };
}
