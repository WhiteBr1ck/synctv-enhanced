import Artplayer from "artplayer";
import type { Events } from "artplayer/types/events";
import { parseTimedText, activeTextCues, type TextCue } from "./timed-text";

interface Subtitle { url: string; type: string; fonts?: string[]; embedded?: boolean; }
interface Track extends Subtitle {
  index: number; title: string; language: string; default: boolean; forced: boolean;
}

export function artplayerSubtitle(subtitles: Record<string, Subtitle>, discovery?: string, preferEmbedded = false) {
  return (art: Artplayer) => {
    const items = { ...subtitles };
    const discoverAbort = new AbortController();
    let selectAbort: AbortController | undefined;
    let disposed = false, selected = "", manual = false, loading = !!discovery;
    let objectUrl: string | undefined;
    let textMode = false;
    let textCues: TextCue[] = [];
    const subtitlePrototype = Object.getPrototypeOf(art.subtitle);
    const nativeCues = Object.getOwnPropertyDescriptor(subtitlePrototype, "cues")!.get!;
    const nativeActive = Object.getOwnPropertyDescriptor(subtitlePrototype, "activeCues")!.get!;
    const original = (getter: () => unknown) => {
      try { return getter.call(art.subtitle); } catch { return []; }
    };
    // MKV playback can expose additional native text tracks. Do not rely on
    // textTracks[0] or an asynchronously loaded <track> for the selected SRT.
    Object.defineProperty(art.subtitle, "cues", { configurable: true,
      get: () => textMode ? textCues : original(nativeCues) });
    Object.defineProperty(art.subtitle, "activeCues", { configurable: true,
      get: () => textMode ? activeTextCues(textCues, art.currentTime) : original(nativeActive) });
    const refreshSubtitle = art.subtitle.update.bind(art.subtitle) as unknown as () => void;
    const updateText = () => { if (!disposed && textMode) refreshSubtitle(); };
    art.on("video:timeupdate", updateText);
    art.on("video:seeked", updateText);
    art.on("video:loadedmetadata", updateText);
    art.on("ready", updateText);
    const emit = (name: string, value: unknown) => art.emit(name as keyof Events, value);
    const html = () => `<span style="background:#fff;color:#000;padding:2px 6px;border-radius:5px;font-size:14px">${loading ? "读取字幕中" : "字幕"}</span>`;
    const select = async (name: string, isManual: boolean) => {
      manual ||= isManual;
      selected = name;
      selectAbort?.abort();
      selectAbort = new AbortController();
      const abort = selectAbort;
      textMode = false;
      textCues = [];
      art.subtitle.show = false;
      art.template.$subtitle.textContent = "";
      emit("artplayer-plugin-ass:visible", false);
      if (name === "关闭") return;
      const item = items[name];
      if (!item) return;
      try {
        let url = item.url;
        let content: Blob | undefined;
        if (item.embedded) {
          art.notice.show = "正在读取内封字幕…";
          const response = await fetch(url, { signal: abort.signal });
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || "内封字幕读取失败，请重新选择字幕重试");
          }
          const blob = await response.blob();
          content = blob;
          if (disposed || abort.signal.aborted) return;
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = URL.createObjectURL(blob);
          url = objectUrl;
          art.notice.show = "";
        }
        if (disposed || abort.signal.aborted) return;
        if (["ass", "ssa"].includes(item.type.toLowerCase())) {
          emit("artplayer-plugin-ass:switch", { url, fonts: item.fonts || [] });
        } else {
          const text = content ? await content.text() : await (await fetch(url, { signal: abort.signal })).text();
          if (disposed || abort.signal.aborted) return;
          textCues = parseTimedText(text);
          if (!textCues.length) throw new Error("字幕文件中没有可显示的文字");
          textMode = true;
          const offset = art.subtitleOffset;
          if (offset) art.subtitleOffset = offset;
          art.subtitle.show = true;
          updateText();
          art.notice.show = "";
        }
      } catch (error: any) {
        if (!disposed && !abort.signal.aborted) art.notice.show = error.message || "字幕加载失败";
      }
    };
    const update = () => {
      if (disposed) return;
      const selector = [...Object.keys(items), "关闭"].map(name => {
        const label = document.createElement("span");
        label.textContent = name;
        return { html: label.innerHTML, name, default: name === selected };
      });
      const onSelect = (item: any) => { void select(item.name, true); return html(); };
      const control = { name: "subtitle", html: html(), selector, onSelect };
      if (!Artplayer.utils.isMobile || art.fullscreen) art.controls.update({ ...control, position: "right" });
      else if (art.controls["subtitle"]) art.controls.remove("subtitle");
      art.setting.update(control);
    };
    update();
    const originalNames = Object.keys(items);
    if (originalNames.length === 1 && !preferEmbedded) void select(originalNames[0], false);
    art.on("fullscreen", update);
    art.on("destroy", () => {
      disposed = true;
      discoverAbort.abort();
      selectAbort?.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    });
    if (discovery) {
      void (async () => {
        try {
          const response = await fetch(discovery, { signal: discoverAbort.signal });
          const value = await response.json();
          if (!response.ok) throw new Error(value.error || "内封字幕读取失败");
          if (disposed) return;
          const tracks: Track[] = value.tracks;
          for (const track of tracks) {
            const name = `内封 · ${track.title} · ${track.type.toUpperCase()} [${track.index}]`;
            items[name] = { ...track, embedded: true };
          }
          loading = false;
          if (!manual && (originalNames.length === 0 || preferEmbedded) && tracks.length) {
            const preferred = tracks.find(track => /^(zh|zho|chi|chs|cht)(-|$)/i.test(track.language) || /中文|简体|繁体/.test(track.title))
              || tracks.find(track => track.default) || tracks[0];
            const name = `内封 · ${preferred.title} · ${preferred.type.toUpperCase()} [${preferred.index}]`;
            void select(name, false);
          } else if (!manual && preferEmbedded && !tracks.length && originalNames.length === 1) {
            void select(originalNames[0], false);
          }
          update();
        } catch (error: any) {
          if (!disposed && !discoverAbort.signal.aborted) {
            loading = false;
            update();
            art.notice.show = error.message || "内封字幕读取失败，请重新打开视频重试";
          }
        }
      })();
    }
    return { name: "artplayerSubtitle" };
  };
}
