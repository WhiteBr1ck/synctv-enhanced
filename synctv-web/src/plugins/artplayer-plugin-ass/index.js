import SubtitlesOctopus from "libass-wasm";
import workerUrl from "libass-wasm/dist/js/subtitles-octopus-worker.js?url";
import wasmUrl from "libass-wasm/dist/js/subtitles-octopus-worker.wasm?url";
import TimesNewRomanFont from "./fonts/TimesNewRoman.ttf?url";
import fallbackFont from "./fonts/SourceHanSansCN-Bold.woff2?url";
import { loadSubtitleAppearance, scaleAss } from "../../utils/subtitle-style";

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
    let buffering = false;
    let offset = 0;
    let appearance = loadSubtitleAppearance();
    let originalContent = "";
    let request;
    const retired = new Set();
    const swaps = new Set();
    const refresh = () => {
      if (!instance?.worker || !instance.workerActive || disposed) return;
      instance.resize();
      instance.setRate(art.video.playbackRate);
      instance.setIsPaused(art.video.paused || art.video.ended || art.video.seeking || buffering || art.video.readyState < 3, art.currentTime + offset);
      instance.setCurrentTime(art.currentTime + offset);
    };
    const updatePosition = () => {
      if (instance?.canvasParent) instance.canvasParent.style.transform = `translateY(-${appearance.lift}%)`;
    };
    const setVisible = (value) => {
      visible = value;
      if (instance?.canvasParent) instance.canvasParent.style.display = value ? "block" : "none";
      for (const old of retired) if (old.canvasParent) old.canvasParent.style.display = value ? "block" : "none";
    };
    const select = async (track) => {
      const current = ++generation;
      request?.abort();
      request = new AbortController();
      const abort = request;
      try {
        const item = typeof track === "string" ? { url: track, fonts: [] } : track;
        const [worker, content] = await Promise.all([loadWorker(), item.content !== undefined ? Promise.resolve(item.content) : fetch(item.url, { signal: abort.signal }).then(response => {
          if (!response.ok) throw new Error("ASS 字幕读取失败");
          return response.text();
        })]);
        if (disposed || current !== generation) return;
        // Keep the previous renderer visible while replacement fonts and WASM
        // initialize. A font upgrade must not blank an already working track.
        if (instance) retired.add(instance);
        originalContent = content;
        instance = new SubtitlesOctopus({
          ...options,
          availableFonts: { "times new roman": absolute(TimesNewRomanFont) },
          workerUrl: worker,
          fallbackFont: absolute(fallbackFont),
          video: art.template.$video,
          subContent: scaleAss(originalContent, appearance.scale),
          fonts: (item.fonts || []).map(absolute),
          onReady: () => {
            if (disposed || current !== generation) return;
            refresh();
            const timer = setTimeout(() => {
              swaps.delete(timer);
              if (disposed || current !== generation) return;
              for (const old of retired) old.dispose();
              retired.clear();
            }, 200);
            swaps.add(timer);
          },
          onError: () => { if (!disposed) art.notice.show = "ASS 字幕显示失败，请重新选择字幕"; }
        });
        instance.timeOffset = offset;
        instance.canvasParent.className = "artplayer-plugin-ass";
        instance.canvasParent.style.cssText = "position:absolute;width:100%;height:100%;user-select:none;pointer-events:none;z-index:20;";
        const renderer = instance;
        // libass-wasm compares CSS `top` ("0px") with a number and clears the
        // canvas even for identical layouts. Keep it intact until size changes.
        const nativeResize = renderer.resize;
        renderer.resize = () => {
          if (disposed || renderer !== instance || !renderer.worker || !art.video.videoWidth) return;
          const pos = renderer.getVideoPosition();
          const width = Math.round(pos.width * renderer.pixelRatio), height = Math.round(pos.height * renderer.pixelRatio);
          if (!width || !height) return;
          if (renderer.canvas.width !== width || renderer.canvas.height !== height) nativeResize(width, height, 0, 0);
          Object.assign(renderer.canvasParent.style, {position:'absolute',inset:'0',width:'100%',height:'100%'});
          Object.assign(renderer.canvas.style,{display:'block',position:'absolute',width:`${pos.width}px`,height:`${pos.height}px`,left:`${pos.x}px`,top:`${pos.y}px`,pointerEvents:'none'});
        };
        updatePosition();
        setVisible(visible);
        refresh();
      } catch {
        if (!disposed && current === generation) art.notice.show = "字幕渲染器加载失败，请重新选择字幕";
      }
    };
    art.on("artplayer-plugin-ass:switch", (track) => { setVisible(true); void select(track); });
    art.on("artplayer-plugin-ass:visible", setVisible);
    art.on("subtitleOffset", (value) => { offset = value; if (instance) instance.timeOffset = value; });
    for (const event of ['video:waiting','video:stalled','video:seeking']) art.on(event, () => { buffering = true; refresh(); });
    art.on('video:playing', () => { buffering = false; refresh(); });
    for (const event of ['ready','restart','resize','fullscreen','fullscreenWeb','video:loadedmetadata','video:seeked','video:pause','video:ended']) art.on(event, refresh);
    art.on("artplayer-plugin-ass:appearance", (value) => {
      const resized = value.scale !== appearance.scale;
      appearance = { ...value };
      if (resized && instance && originalContent) instance.setTrack(scaleAss(originalContent, appearance.scale));
      updatePosition();
      refresh();
    });
    art.on("destroy", () => {
      disposed = true; generation++; request?.abort();
      for (const timer of swaps) clearTimeout(timer);
      for (const old of retired) old.dispose();
      retired.clear(); swaps.clear(); instance?.dispose(); instance = null;
    });
    if (options.subUrl) { setVisible(true); void select(options.subUrl); }
    return { name: "artplayerPluginAss", get instance() { return instance; } };
  };
}
