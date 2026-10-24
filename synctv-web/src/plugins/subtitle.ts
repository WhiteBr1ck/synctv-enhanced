import Artplayer from "artplayer";
import { parseTimedText, activeTextCues, type TextCue } from "./timed-text";
import { trackLabel, escapeLabel, type TrackMetadata } from "@/utils/track-label";
import { controlIcon, icon } from "./icons";

interface Subtitle extends TrackMetadata {
  url: string;
  type: string;
  fonts?: string[];
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
  preferEmbedded = false
) {
  return (art: Artplayer) => {
    const items = new Map<string, Subtitle>(
      Object.entries(subtitles).map(([key, item]) => [
        key,
        { ...item, title: item.title || item.name || key, origin: item.origin || "external" }
      ])
    );
    let selected = "",
      selectedUrl = "",
      manual = false,
      disposed = false,
      textMode = false;
    let textCues: TextCue[] = [];
    const discoveryAbort = new AbortController();
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
    const select = async (key: string, isManual = false) => {
      selected = key;
      manual ||= isManual;
      selectAbort?.abort();
      const controller = (selectAbort = new AbortController());
      const item = items.get(key);
      selectedUrl = item?.url || "";
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
        const response = await fetch(item.url, { signal: controller.signal });
        if (!response.ok) throw new Error("字幕读取失败，请重新选择字幕");
        const content = await response.text();
        if (disposed || controller.signal.aborted) return;
        clear();
        if (/^(ass|ssa)$/i.test(item.type))
          emit("artplayer-plugin-ass:switch", { content, fonts: item.fonts || [] });
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
          choose();
        }
      }
    };
    const update = () => {
      if (disposed) return;
      const selector = [...items].map(([key, item], i) => ({
        html: escapeLabel(trackLabel(item, `字幕 ${i + 1}`)),
        key,
        default: key === selected
      }));
      selector.push({ html: "关闭", key: "", default: !selected });
      const onSelect = (item: any) => {
        void select(item.key, true);
        return controlIcon("subtitle", "字幕");
      };
      if (!Artplayer.utils.isMobile || art.fullscreen)
        art.controls.update({
          name: "subtitle",
          position: "right",
          html: controlIcon("subtitle", "字幕"),
          selector,
          onSelect
        });
      else if (art.controls.subtitle) art.controls.remove("subtitle");
      art.setting.update({
        name: "subtitle",
        html: "字幕",
        icon: icon("subtitle"),
        selector,
        onSelect: (item: any) => {
          void select(item.key, true);
          return item.key ? "已选择" : "关闭";
        },
        width: 420
      });
    };
    const choose = () => {
      if (disposed || selectAbort) return;
      if (manual) {
        const same = items.get(selected);
        if (same && same.url !== selectedUrl) void select(selected);
        return;
      }
      if (preference?.enabled === false) {
        void select("");
        return;
      }
      const entries = [...items];
      const match =
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
      if (match && (match[0] !== selected || match[1].url !== selectedUrl)) void select(match[0]);
    };
    update();
    // Jellyfin's existing subtitle URL is usable immediately. Probing the
    // original file (including fonts) must not hold up subtitles after a switch.
    choose();
    if (discovery)
      void (async () => {
        try {
          const response = await fetch(discovery, { signal: discoveryAbort.signal });
          if (!response.ok) throw new Error("字幕轨道读取失败");
          const { tracks } = (await response.json()) as { tracks: Track[] };
          if (disposed) return;
          for (const track of tracks) {
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
            items.set(target, { ...metadata, ...track, title, origin: "embedded" });
          }
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
      selectAbort?.abort();
    });
    return { name: "artplayerSubtitle" };
  };
}
