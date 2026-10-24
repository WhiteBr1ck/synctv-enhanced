import Artplayer from "artplayer";
import type { BaseMovieInfo } from "@/types/Movie";
import type { VideoInfo } from "@/utils/video-info";
import { playbackSummary } from "@/utils/playback-summary";
import "./video-info.css";

interface ProbeInfo {
  video?: VideoInfo | null;
  audioTracks?: any[];
  container?: string;
  sourceIndex?: number;
}
export function artplayerVideoInfo(initialContext: BaseMovieInfo) {
  return (art: Artplayer) => {
    let context = initialContext,
      info: ProbeInfo | undefined,
      request: AbortController | undefined,
      timer: ReturnType<typeof setInterval> | undefined,
      disposed = false;
    let waits = 0,
      waitStart = 0,
      waitTotal = 0,
      lastWait = "";
    const waiting = () => {
      if (!waitStart) {
        waitStart = performance.now();
        waits++;
        lastWait = new Date().toLocaleTimeString();
      }
    };
    const playing = () => {
      if (waitStart) {
        waitTotal += performance.now() - waitStart;
        waitStart = 0;
      }
    };
    art.on("video:waiting", waiting);
    art.on("video:stalled", waiting);
    art.on("video:playing", playing);
    art.on("video:pause", playing);
    const section = document.createElement("div");
    section.className = "synctv-video-info-extra";
    art.template.$info.classList.add("synctv-video-info");
    const rows = new Map<string, HTMLElement>();
    for (const [key, label] of Object.entries({
      resolution: "视频分辨率",
      window: "窗口分辨率",
      fps: "帧率",
      codec: "解码格式",
      playback: "播放方式",
      depth: "色深",
      audio: "音频",
      buffer: "缓冲",
      waiting: "缓冲等待",
      sync: "最近同步跳转",
      range: "动态范围"
    })) {
      const row = document.createElement("div");
      row.className = "art-info-item";
      const title = document.createElement("div");
      title.className = "art-info-title";
      title.textContent = label;
      const content = document.createElement("div");
      content.className = "art-info-content";
      content.dataset.stat = key;
      row.append(title, content);
      section.append(row);
      rows.set(key, content);
    }
    art.template.$infoPanel.append(section);
    const set = (key: string, value: string) => {
      const row = rows.get(key)!;
      if (row.textContent !== value) row.textContent = value;
    };
    const refresh = () => {
      if (disposed) return;
      const video = art.video;
      const selected = art.plugins?.source?.currentSource?.() || {
        url: context.url,
        html: "默认",
        type: context.type,
        playbackMode: context.playbackMode
      };
      const hls = art.hls;
      const level = hls?.levels?.[hls.currentLevel >= 0 ? hls.currentLevel : 0];
      const audioTrack = hls?.audioTracks?.[hls.audioTrack];
      const summary = playbackSummary(
        selected,
        info?.video || undefined,
        info?.audioTracks,
        context.videoRange,
        level?.videoCodec,
        audioTrack?.attrs?.CODECS || level?.audioCodec,
        art.plugins?.audioCompat?.info?.()
      );
      const rect = video.getBoundingClientRect();
      set("resolution", video.videoWidth ? `${video.videoWidth} × ${video.videoHeight}` : "—");
      set("window", `${Math.round(rect.width)} × ${Math.round(rect.height)}`);
      const fps =
        level?.frameRate || Number(level?.attrs?.["FRAME-RATE"]) || info?.video?.frameRate;
      set("fps", fps ? `${Number(fps.toFixed(3))} fps` : "—");
      set("codec", summary.codec);
      set("playback", summary.transcoded ? "转码" : "直通");
      set("depth", summary.depth ? `${summary.depth} bit` : "—");
      set("audio", summary.audio);
      set("range", summary.dynamicRange);
      let ahead = 0;
      for (let i = 0; i < video.buffered.length; i++)
        if (
          video.buffered.start(i) <= video.currentTime &&
          video.buffered.end(i) >= video.currentTime
        )
          ahead = video.buffered.end(i) - video.currentTime;
      set("buffer", `${ahead.toFixed(1)} 秒`);
      const duration = (waitTotal + (waitStart ? performance.now() - waitStart : 0)) / 1000;
      set("waiting", `${waits} 次 · ${duration.toFixed(1)} 秒${lastWait ? ` · ${lastWait}` : ""}`);
      const correction = art.plugins?.syncPlugin?.lastCorrection?.();
      set("sync", correction === "尚未发生同步跳转" || !correction ? "—" : correction);
    };
    const load = async () => {
      if (!context.mediaInfoSource || info || request || disposed) return;
      const controller = (request = new AbortController());
      try {
        const response = await fetch(context.mediaInfoSource, { signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json();
        if (!disposed && !controller.signal.aborted) info = result;
      } catch {
        /* unavailable fields remain a dash */
      } finally {
        if (request === controller) request = undefined;
        if (!controller.signal.aborted) refresh();
      }
    };
    art.on("info", (show: boolean) => {
      clearInterval(timer);
      if (show) {
        refresh();
        void load();
        timer = setInterval(refresh, 500);
      }
    });
    art.on("destroy", () => {
      disposed = true;
      request?.abort();
      clearInterval(timer);
      section.remove();
    });
    refresh();
    return {
      name: "videoInfo",
      updateContext: (next: BaseMovieInfo) => {
        request?.abort();
        request = undefined;
        context = next;
        info = undefined;
        refresh();
        if (art.info.show) void load();
      }
    };
  };
}
