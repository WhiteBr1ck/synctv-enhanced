import Artplayer from "artplayer";
import { loadSubtitleAppearance, subtitleAppearanceKey, subtitleScales, subtitleLifts } from "@/utils/subtitle-style";

export function artplayerSubtitleStyle() {
  return (art: Artplayer) => {
    let appearance = loadSubtitleAppearance();
    const root = art.template.$player;
    const bottom = getComputedStyle(root).getPropertyValue("--art-subtitle-bottom").trim() || "20px";
    const apply = () => {
      art.subtitle.style("fontSize", `calc(var(--art-subtitle-font-size, 20px) * ${appearance.scale})`);
      root.style.setProperty("--art-subtitle-bottom", `calc(${bottom} + ${root.clientHeight * appearance.lift / 100}px)`);
      art.emit("artplayer-plugin-ass:appearance" as any, appearance);
    };
    const save = () => {
      try { localStorage.setItem(subtitleAppearanceKey, JSON.stringify(appearance)); } catch { /* storage unavailable */ }
      apply();
    };
    art.setting.add({ name: "subtitle-size", html: "字幕大小", tooltip: `${appearance.scale * 100}%`,
      selector: subtitleScales.map(scale => ({ html: scale === 1 ? "100%（原始大小）" : `${scale * 100}%`, scale, default: scale === appearance.scale })),
      onSelect(item: any) { appearance.scale = item.scale; save(); return `${item.scale * 100}%`; } });
    art.setting.add({ name: "subtitle-position", html: "字幕位置", tooltip: appearance.lift ? `上移 ${appearance.lift}%` : "原始位置",
      selector: subtitleLifts.map(lift => ({ html: lift ? `上移 ${lift}%` : "原始位置", lift, default: lift === appearance.lift })),
      onSelect(item: any) { appearance.lift = item.lift; save(); return item.html; } });
    const observer = new ResizeObserver(apply);
    observer.observe(root);
    art.on("ready", apply);
    art.on("destroy", () => observer.disconnect());
    apply();
    return { name: "subtitleStyle", appearance: () => ({ ...appearance }) };
  };
}
