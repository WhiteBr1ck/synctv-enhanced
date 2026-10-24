import Artplayer from "artplayer";
import { loadSubtitleAppearance, subtitleAppearanceKey, subtitleScales, subtitleLifts } from "@/utils/subtitle-style";
import { icon } from "./icons";

export function artplayerSubtitleStyle() {
  return (art: Artplayer) => {
    let appearance = loadSubtitleAppearance();
    let colorInput: HTMLInputElement | undefined;
    const root = art.template.$player;
    const bottom = getComputedStyle(root).getPropertyValue("--art-subtitle-bottom").trim() || "20px";
    const apply = () => {
      art.subtitle.style("fontSize", `calc(var(--art-subtitle-font-size, 20px) * ${appearance.scale})`);
      root.style.setProperty('--synctv-srt-color', appearance.color);
      if(colorInput)colorInput.value=appearance.color;
      root.style.setProperty("--art-subtitle-bottom", `calc(${bottom} + ${root.clientHeight * appearance.lift / 100}px)`);
      art.emit("artplayer-plugin-ass:appearance" as any, appearance);
    };
    const save = () => {
      try { localStorage.setItem(subtitleAppearanceKey, JSON.stringify(appearance)); } catch { /* storage unavailable */ }
      apply();
    };
    art.setting.add({ name: "subtitle-size", html: "字幕大小", icon: icon('size'), tooltip: `${appearance.scale * 100}%`,
      selector: subtitleScales.map(scale => ({ html: scale === 1 ? "100%（原始大小）" : `${scale * 100}%`, scale, default: scale === appearance.scale })),
      onSelect(item: any) { appearance.scale = item.scale; save(); return `${item.scale * 100}%`; } });
    art.setting.add({ name: "subtitle-position", html: "字幕位置", icon: icon('position'), tooltip: appearance.lift ? `上移 ${appearance.lift}%` : "原始位置",
      selector: subtitleLifts.map(lift => ({ html: lift ? `上移 ${lift}%` : "原始位置", lift, default: lift === appearance.lift })),
      onSelect(item: any) { appearance.lift = item.lift; save(); return item.html; } });
    const colors = [{html:'白色',color:'#ffffff'},{html:'黄色',color:'#ffff00'},{html:'青色',color:'#00ffff'},{html:'绿色',color:'#80ff80'},{html:'粉色',color:'#ffb3d9'},{html:'蓝色',color:'#80bfff'}];
    art.setting.add({name:'subtitle-color',html:'SRT 字幕颜色',tooltip:colors.find(c=>c.color===appearance.color)?.html||'自定义',icon:icon('color'),selector:colors.map(c=>({...c,default:c.color===appearance.color})),
      onSelect(item:any){appearance.color=item.color;save();return item.html;}});
    art.setting.add({name:'subtitle-custom-color',html:'自定义 SRT 颜色',icon:icon('color'),mounted:(_,item:any)=>{
      const input=document.createElement('input');input.type='color';input.value=appearance.color;input.setAttribute('aria-label','自定义 SRT 颜色');
      colorInput=input;
      input.style.cssText='width:40px;height:25px;background:transparent;border:0;cursor:pointer';item.$tooltip.replaceChildren(input);
      art.proxy(input,'input',()=>{appearance.color=input.value;save();});
    }});
    const offsetSetting=art.setting.find('subtitle-offset');
    if(offsetSetting)offsetSetting.$icon.innerHTML=icon('clock');
    const observer = new ResizeObserver(apply);
    observer.observe(root);
    art.on("ready", apply);
    art.on("destroy", () => observer.disconnect());
    apply();
    return { name: "subtitleStyle", appearance: () => ({ ...appearance }) };
  };
}
