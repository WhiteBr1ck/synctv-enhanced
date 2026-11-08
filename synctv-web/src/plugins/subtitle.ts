import Artplayer from "artplayer";
import { parseTimedText, activeTextCues, type TextCue } from "./timed-text";
import { trackLabel, escapeLabel, type TrackMetadata } from "@/utils/track-label";
import { controlIcon, icon } from "./icons";
import { resolveAssSubsetFonts } from "@/utils/ass-fonts";
import { subtitlePicker, type FolderSubtitle } from "./subtitle-picker";

interface Subtitle extends TrackMetadata {
  url: string;
  type: string;
  fonts?: string[];
  fontFiles?: { name: string }[];
  headers?: Record<string, string>;
  matchRank?: number;
}
interface Track extends Subtitle {
  index: number;
  title: string;
  language: string;
  default: boolean;
  forced: boolean;
}
export function artplayerSubtitle(
  subtitles: Record<string, Subtitle>,
  discovery?: string,
  preferEmbedded = false,
  folder?: { url: string; headers: Record<string, string> }
) {
  return (art: Artplayer) => {
    const items = new Map<string, Subtitle>(
      Object.entries(subtitles).map(([key, item]) => [
        key,
        { ...item, title: item.title || item.name || key, origin: item.origin || "external" }
      ])
    );
    let selected = "",
      selectedVersion = "",
      manual = false,
      disposed = false,
      textMode = false,
      loading = false;
    let textCues: TextCue[] = [];
    const discoveryAbort = new AbortController();
    const folderAbort = new AbortController();
    let folderTracks: FolderSubtitle[] | undefined;
    let folderLoading: Promise<FolderSubtitle[]> | undefined;
    let picker: ReturnType<typeof subtitlePicker> | undefined;
    let attachedFonts: Pick<Subtitle, "fonts" | "fontFiles"> = {};
    let selectAbort: AbortController | undefined;
    let preference: any;
    try {
      preference = JSON.parse(localStorage.getItem("synctv:subtitle-track") || "null");
    } catch {
      /* empty */
    }
    const prototype = Object.getPrototypeOf(art.subtitle);
    const nativeCues = Object.getOwnPropertyDescriptor(prototype, "cues")!.get!;
    const nativeActive = Object.getOwnPropertyDescriptor(prototype, "activeCues")!.get!;
    const native = (getter: () => unknown) => {
      try {
        return getter.call(art.subtitle);
      } catch {
        return [];
      }
    };
    Object.defineProperty(art.subtitle, "cues", {
      configurable: true,
      get: () => (textMode ? textCues : native(nativeCues))
    });
    Object.defineProperty(art.subtitle, "activeCues", {
      configurable: true,
      get: () => (textMode ? activeTextCues(textCues, art.currentTime) : native(nativeActive))
    });
    const refreshSubtitle = art.subtitle.update.bind(art.subtitle) as unknown as () => void;
    const refresh = () => {
      if (!disposed && textMode) refreshSubtitle();
    };
    for (const event of ["video:timeupdate", "video:seeked", "ready", "restart"])
      art.on(event as any, refresh);
    const emit = (name: string, value: unknown) => art.emit(name as any, value);
    const version = (item?: Subtitle) => JSON.stringify([item?.url || "", item?.fonts || [], item?.fontFiles || []]);
    const select = async (key: string, isManual = false) => {
      selected = key;
      manual ||= isManual;
      selectAbort?.abort();
      const controller = (selectAbort = new AbortController());
      const item = items.get(key);
      loading = !!item;
      selectedVersion = version(item);
      const clear = () => {
        textMode = false;
        textCues = [];
        art.subtitle.show = false;
        art.template.$subtitle.textContent = "";
        emit("artplayer-plugin-ass:visible", false);
      };
      if (isManual)
        try {
          localStorage.setItem(
            "synctv:subtitle-track",
            JSON.stringify(
              item
                ? {
                    enabled: true,
                    language: item.language,
                    type: item.type,
                    origin: item.origin,
                    title: item.title
                  }
                : { enabled: false }
            )
          );
        } catch {
          /* storage */
        }
      update();
      if (!item) {
        clear();
        selectAbort = undefined;
        return;
      }
      try {
        const deadline = Date.now() + 360000;
        const loadingNotice = "正在提取内封字幕，请稍候…";
        let first = true;
        let content = "";
        while (true) {
          const retry = first && /\/_synctv\/subtitles\//.test(item.url);
          first = false;
          const url = retry ? `${item.url}${item.url.includes("?") ? "&" : "?"}retry=1` : item.url;
          const response = await fetch(url, { signal: controller.signal, headers: item.headers });
          if (disposed || controller.signal.aborted) return;
          if (response.status !== 202) {
            if (!response.ok) throw new Error("字幕读取失败，请重新选择字幕");
            content = await response.text();
            break;
          }
          if (Date.now() >= deadline) throw new Error("字幕提取等待超时，请重新选择字幕");
          art.notice.show = loadingNotice;
          const seconds = Number(response.headers?.get("Retry-After")) || 1;
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
            const timer = setTimeout(() => { controller.signal.removeEventListener("abort", abort); resolve(); }, Math.max(0.05, Math.min(3, seconds)) * 1000);
            controller.signal.addEventListener("abort", abort, { once: true });
            if (controller.signal.aborted) abort();
          });
        }
        if (disposed || controller.signal.aborted) return;
        if (art.template.$noticeInner?.textContent === loadingNotice || art.notice.show === loadingNotice) art.notice.show = "";
        clear();
        if (/^(ass|ssa)$/i.test(item.type))
          emit("artplayer-plugin-ass:switch", { content: resolveAssSubsetFonts(content, item.fontFiles), fonts: item.fonts || [] });
        else {
          textCues = parseTimedText(content);
          if (!textCues.length) throw new Error("字幕中没有可显示的文字");
          textMode = true;
          art.template.$subtitle.classList.toggle("synctv-srt", /^(srt|subrip)$/i.test(item.type));
          const offset = art.subtitleOffset;
          if (offset) art.subtitleOffset = offset;
          art.subtitle.show = true;
          refresh();
        }
      } catch (error: any) {
        if (!disposed && !controller.signal.aborted) art.notice.show = error.message;
      } finally {
        if (selectAbort === controller) {
          selectAbort = undefined;
          loading = false;
          update();
          choose();
        }
      }
    };
    const update = () => {
      if (disposed) return;
      const selector = [...items].map(([key, item], i) => ({
        html: escapeLabel(trackLabel(item, `字幕 ${i + 1}`) + (key === selected && loading ? "（读取中）" : "")),
        key,
        default: key === selected
      }));
      if (folder) selector.push({ html: "从同文件夹添加字幕…", key: "folder:add", default: false });
      selector.push({ html: "关闭", key: "", default: !selected });
      const activate = (key: string) => {
        if (key !== "folder:add") { void select(key, true); return; }
        picker ||= subtitlePicker(art.template.$player, loadFolder, item => { void select(addFolderTrack(item), true); });
        art.setting.show = false;
        picker.open();
      };
      const onSelect = (item: any) => {
        activate(item.key);
        return controlIcon("subtitle", "字幕");
      };
      if (art.controls.subtitle) art.controls.remove("subtitle");
      art.setting.update({
        name: "subtitle",
        html: "字幕",
        icon: icon("subtitle"),
        selector,
        onSelect: (item: any) => {
          activate(item.key);
          return item.key ? "已选择" : "关闭";
        },
        width: 420
      });
    };
    const choose = () => {
      if (disposed || selectAbort) return;
      if (manual) {
        const same = items.get(selected);
        if (same && version(same) !== selectedVersion) void select(selected);
        return;
      }
      if (preference?.enabled === false) {
        void select("");
        return;
      }
      const entries = [...items];
      const matched = entries.filter(([, item]) => (item.matchRank || 0) > 0);
      const rank = Math.max(0, ...matched.map(([, item]) => item.matchRank || 0));
      const sameName = matched.filter(([, item]) => item.matchRank === rank);
      const match =
        sameName.find(([, t]) => t.language === preference?.language && t.type === preference?.type) ||
        sameName.find(([, t]) => /^(zh|chi|zho|chs|cht)/i.test(t.language || "")) || sameName[0] ||
        (preference &&
          entries.find(
            ([, t]) =>
              t.language === preference.language &&
              t.type === preference.type &&
              t.origin === preference.origin &&
              t.title === preference.title
          )) ||
        (preference &&
          entries.find(
            ([, t]) => t.language === preference.language && t.type === preference.type
          )) ||
        entries.find(([, t]) => t.default) ||
        entries.find(([, t]) => /^(zh|chi|zho|chs|cht)/i.test(t.language || "")) ||
        entries[0];
      if (match && (match[0] !== selected || version(match[1]) !== selectedVersion)) void select(match[0]);
    };
    const addFolderTrack = (track: FolderSubtitle) => {
      const previous = [...items].find(([, item]) => item.origin === "external" && (item.name === track.name || item.title === track.name));
      const key = previous?.[0] || `folder:${track.name}`;
      items.set(key, { ...track, ...(/^(ass|ssa)$/i.test(track.type) ? attachedFonts : {}), headers: folder?.headers });
      return key;
    };
    const loadFolder = (refresh = false): Promise<FolderSubtitle[]> => {
      if (folderLoading) return folderLoading;
      if (folderTracks && !refresh) return Promise.resolve(folderTracks);
      if (!folder) return Promise.resolve([]);
      const url = folder.url + (refresh ? `${folder.url.includes("?") ? "&" : "?"}refresh=1` : "");
      folderLoading = (async () => {
        const response = await fetch(url, { headers: folder.headers, signal: folderAbort.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "读取字幕目录失败，请重试");
        if (disposed) return [];
        folderTracks = (result.data || result).tracks || [];
        for (const track of folderTracks!) if (track.matchRank) addFolderTrack(track);
        update(); choose();
        return folderTracks!;
      })().finally(() => { folderLoading = undefined; });
      return folderLoading;
    };
    update();
    // Jellyfin's existing subtitle URL is usable immediately. Probing the
    // original file (including fonts) must not hold up subtitles after a switch.
    choose();
    if (folder) void loadFolder().catch(() => { /* Manual picker exposes errors and retry. */ });
    if (discovery)
      void (async () => {
        try {
          const response = await fetch(discovery, { signal: discoveryAbort.signal });
          if (!response.ok) throw new Error("字幕轨道读取失败");
          const { tracks } = (await response.json()) as { tracks: Track[] };
          if (disposed) return;
          for (const track of tracks) {
            if (track.fonts?.length) attachedFonts = { fonts: track.fonts, fontFiles: track.fontFiles };
            let metadata: Subtitle | undefined;
            let target = `embedded:${track.index}`;
            for (const [key, old] of items)
              if (old.origin === "embedded" && old.index === track.index) {
                metadata = old;
                target = key;
                items.delete(key);
              }
            const title =
              track.title && track.title !== track.language
                ? track.title
                : metadata?.title || track.title;
            // Keep the server's complete, immediately available ASS. Discovery
            // adds fonts without forcing a second full scan of the movie.
            items.set(target, { ...metadata, ...track, url: metadata?.url || track.url, title, origin: "embedded" });
          }
          for (const [key, item] of items) if (item.headers && /^(ass|ssa)$/i.test(item.type)) items.set(key, { ...item, ...attachedFonts });
          update();
          choose();
        } catch {
          if (!disposed) choose();
        }
      })();
    art.on("fullscreen", update);
    art.on("destroy", () => {
      disposed = true;
      discoveryAbort.abort();
      folderAbort.abort();
      picker?.close();
      selectAbort?.abort();
    });
    return { name: "artplayerSubtitle" };
  };
}
