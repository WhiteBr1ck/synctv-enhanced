import SubtitlesOctopus from "libass-wasm";
import workerUrl from "libass-wasm/dist/js/subtitles-octopus-worker.js?url";
import wasmUrl from "libass-wasm/dist/js/subtitles-octopus-worker.wasm?url";
import TimesNewRomanFont from "./fonts/TimesNewRoman.ttf?url";
import fallbackFont from "./fonts/SourceHanSansCN-Bold.woff2?url";

const absolute = (url) => new URL(url, document.baseURI).toString();
let workerPromise;
function loadWorker() {
  if (!workerPromise) {
    workerPromise = fetch(workerUrl).then(async (response) => {
      if (!response.ok) throw new Error("字幕渲染器加载失败");
      const text = (await response.text()).replace(
        /wasmBinaryFile\s*=\s*"subtitles-octopus-worker\.wasm"/g,
        () => `wasmBinaryFile = "${absolute(wasmUrl)}"`
      );
      return URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
    }).catch((error) => { workerPromise = null; throw error; });
  }
  return workerPromise;
}

export default function artplayerPluginAss(options = {}) {
  return (art) => {
    let instance = null;
    let disposed = false;
    let generation = 0;
    let visible = false;
    let offset = 0;
    const setVisible = (value) => {
      visible = value;
      if (instance?.canvasParent) instance.canvasParent.style.display = value ? "block" : "none";
    };
    const select = async (track) => {
      const current = ++generation;
      try {
        const worker = await loadWorker();
        if (disposed || current !== generation) return;
        instance?.dispose();
        const item = typeof track === "string" ? { url: track, fonts: [] } : track;
        instance = new SubtitlesOctopus({
          ...options,
          availableFonts: { "times new roman": absolute(TimesNewRomanFont) },
          workerUrl: worker,
          fallbackFont: absolute(fallbackFont),
          video: art.template.$video,
          subUrl: item.url,
          fonts: (item.fonts || []).map(absolute),
          onError: () => { if (!disposed) art.notice.show = "ASS 字幕显示失败，请重新选择字幕"; }
        });
        instance.timeOffset = offset;
        instance.canvasParent.className = "artplayer-plugin-ass";
        instance.canvasParent.style.cssText = "position:absolute;width:100%;height:100%;user-select:none;pointer-events:none;z-index:20;";
        setVisible(visible);
      } catch {
        if (!disposed && current === generation) art.notice.show = "字幕渲染器加载失败，请重新选择字幕";
      }
    };
    art.on("artplayer-plugin-ass:switch", (track) => { setVisible(true); void select(track); });
    art.on("artplayer-plugin-ass:visible", setVisible);
    art.on("subtitleOffset", (value) => { offset = value; if (instance) instance.timeOffset = value; });
    art.on("destroy", () => { disposed = true; generation++; instance?.dispose(); instance = null; });
    if (options.subUrl) { setVisible(true); void select(options.subUrl); }
    return { name: "artplayerPluginAss", get instance() { return instance; } };
  };
}
