import Artplayer from "artplayer";
import type { BaseMovieInfo } from "@/types/Movie";
import { basicDecodeType, describePlayback, describeVideo, type VideoInfo } from "@/utils/video-info";
import "./video-info.css";

interface ProbeInfo { video?: VideoInfo | null; container?: string; sourceIndex?: number; }

export function artplayerVideoInfo(initialContext: BaseMovieInfo) {
  return (art: Artplayer) => {
    let context = initialContext;
    let info: ProbeInfo | undefined;
    let state = context.mediaInfoSource ? "打开统计信息时读取" : "该来源暂不提供探测信息";
    let request: AbortController | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;
    let lastBuffer = "尚无缓冲等待记录";
    let waits = 0;
    const buffering = () => { lastBuffer = `${new Date().toLocaleTimeString()} · 等待数据（累计 ${++waits} 次）`; };
    art.on("video:waiting", buffering);
    art.on("video:stalled", buffering);
    const panel = art.template.$infoPanel;
    art.template.$info.classList.add("synctv-video-info");
    const section = document.createElement("div");
    section.className = "synctv-video-info-extra";
    const rows = new Map<string, HTMLElement>();
    const add = (key: string, label: string, explanation?: string) => {
      const row = document.createElement("div");
      row.className = "art-info-item";
      const title = document.createElement("div");
      title.className = "art-info-title";
      title.textContent = label;
      const content = document.createElement("div");
      content.className = "art-info-content";
      content.dataset.stat = key;
      if (explanation) row.title = explanation;
      row.append(title, content);
      section.append(row);
      rows.set(key, content);
    };
    add("playback", "播放方式");
    add("source", "探测片源");
    add("video", "片源视频");
    add("range", "片源动态范围");
    add("color", "片源色彩");
    add("audio", "声音播放");
    add("buffer", "前方缓冲");
    add("waiting", "最近缓冲等待");
    add("sync", "最近同步跳转");
    add("switch", "最近换源");
    add("display", "本机 HDR 能力", "浏览器报告的显示能力；不代表当前画面正在以 HDR 输出。");
    add("decode", "本机编码支持", "代表性编码规格的基础检测；不保证当前影片的封装、级别和完整规格都兼容。");
    const note = document.createElement("div");
    note.className = "synctv-video-info-note";
    note.textContent = "能力检测仅供参考，无法据此确认实际 HDR 输出。片源信息对应探测源，切换后的流可能不同。";
    section.append(note);
    panel.append(section);
    const set = (key: string, text: string) => {
      const row = rows.get(key)!;
      if (row.textContent !== text) { row.textContent = text; row.title = text; }
    };
    const refresh = () => {
      if (disposed) return;
      const selected = art.plugins?.source?.currentSource?.();
      const source = selected || { playbackMode: context.playbackMode, html: "默认", type: context.type };
      set("playback", describePlayback(source.playbackMode, context.vendorInfo?.vendor, source.html, source.type));
      const probed = info?.sourceIndex === 0 ? "默认" : context.moreSources?.[(info?.sourceIndex ?? 0) - 1]?.name;
      set("source", info ? `${probed || "未知源"}${source.html !== probed ? `（当前选择：${source.html}）` : ""}` : state);
      set("video", describeVideo(info?.video));
      set("range", info?.video?.dynamicRange || "未知");
      set("color", [info?.video?.colorPrimaries, info?.video?.colorTransfer, info?.video?.colorSpace].filter(Boolean).join(" / ") || "未标注");
      set("audio", art.plugins?.audioCompat?.status?.() || "浏览器原生音频");
      const video = art.video;
      let ahead = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime) ahead = video.buffered.end(i) - video.currentTime;
      }
      const quality = video.getVideoPlaybackQuality?.();
      set("buffer", `${ahead.toFixed(1)} 秒 · readyState ${video.readyState}${quality ? ` · 丢帧 ${quality.droppedVideoFrames}/${quality.totalVideoFrames}` : ""}${video.error ? ` · 播放错误 ${video.error.code}` : ""}`);
      set("waiting", lastBuffer);
      set("sync", art.plugins?.syncPlugin?.lastCorrection?.() || "无房间同步记录");
      set("switch", art.plugins?.source?.lastChange?.() || "初始播放");
      let hdr: boolean | undefined;
      try { hdr = window.matchMedia("(dynamic-range: high)").matches; } catch { /* unavailable */ }
      set("display", hdr ? "浏览器报告支持 HDR" : "未报告 HDR 能力（未开启或检测不受支持）");
      const type = basicDecodeType(info?.video || undefined);
      const support = type ? art.video.canPlayType(type) : "";
      set("decode", type ? `${info!.video!.codec!.toUpperCase()} 基础规格：${support === "probably" ? "报告支持" : support === "maybe" ? "可能支持" : "未报告支持"}` : "暂无对应编码信息");
    };
    const load = async () => {
      if (!context.mediaInfoSource || info || request || disposed) return;
      const controller = request = new AbortController();
      state = "正在读取片源信息…";
      refresh();
      try {
        const response = await fetch(context.mediaInfoSource, { signal: controller.signal });
        if (!response.ok) throw new Error("probe failed");
        const value: ProbeInfo = await response.json();
        if (disposed || controller.signal.aborted) return;
        info = value;
      } catch {
        if (!disposed && !controller.signal.aborted) state = "读取失败，关闭后重开可重试";
      } finally {
        if (request === controller) request = undefined;
        if (!controller.signal.aborted) refresh();
      }
    };
    const visible = (show: boolean) => {
      clearInterval(timer);
      timer = undefined;
      if (show) { refresh(); void load(); timer = setInterval(refresh, 1000); }
    };
    art.on("info", visible);
    art.on("destroy", () => { disposed = true; request?.abort(); clearInterval(timer); section.remove(); });
    refresh();
    return { name: "videoInfo", updateContext: (next: BaseMovieInfo) => {
      request?.abort(); request = undefined; context = next; info = undefined;
      state = context.mediaInfoSource ? "打开统计信息时读取" : "该来源暂不提供探测信息";
      refresh();
      if (art.info.show) void load();
    } };
  };
}
