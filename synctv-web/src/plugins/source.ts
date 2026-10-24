import Artplayer from "artplayer";
import { destroyOldCustomPlayLib } from "@/utils";

interface artplayPluginSource {
  html: string;
  url: string;
  type: string;
  playbackMode?: "direct" | "transcode";
}

const switchSource = (art: Artplayer, source: artplayPluginSource) => {
  const status = art.plugins["syncPlugin"].currentStatus();
  const restore = () => {
    art.plugins["syncPlugin"].setAndNoPublishStatus(status);
    art.emit("restart", source.url);
  };
  art.once("video:canplay", restore);
  if (art.controls["quality"]) art.controls.remove("quality");
  if (art.setting.find("quality")) art.setting.remove("quality");
  if (art.controls["audio"]) art.controls.remove("audio");
  if (art.setting.find("audio")) art.setting.remove("audio");
  destroyOldCustomPlayLib(art);
  art.option.type = source.type;
  art.url = source.url;
  return () => art.off("video:canplay", restore);
};

export function artplayPluginSource(sources: artplayPluginSource[]) {
  return (art: Artplayer) => {
    let sourceList=sources;
    let currentSourceName = sources.length > 0 ? sources[0].html : "";
    let currentSource = sources[0];
    let cancelRestore: (() => unknown) | undefined;
    let lastChange = "初始播放";
    const onSelect = (source: artplayPluginSource) => {
      const unchanged = source.url === currentSource?.url && source.type === currentSource?.type;
      currentSource = source;
      currentSourceName = source.html;
      if (!unchanged) {
        cancelRestore?.();
        lastChange = `${new Date().toLocaleTimeString()} · ${source.html}`;
        cancelRestore = switchSource(art, source);
      }
      art.emit('synctv:sources' as any);
      return "源";
    };
    const setSelector = (newSources: artplayPluginSource[]) => {
      sourceList=newSources;
    };
    const updateSources = (newSources: artplayPluginSource[]) => {
      setSelector(newSources);
      const oldSource = newSources.find((v) => v.html === currentSourceName);
      if (oldSource) {
        onSelect(oldSource);
      }
    };
    setSelector(sources);
    art.on("destroy", () => cancelRestore?.());
    return {
      name: "source",
      updateSources,
      currentSource: () => currentSource,
      entries:()=>sourceList,
      selectSource:(index:number)=>{if(sourceList[index])onSelect(sourceList[index]);},
      lastChange: () => lastChange
    };
  };
}
