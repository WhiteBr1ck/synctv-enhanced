import { trackLabel, type TrackMetadata } from "@/utils/track-label";

export interface FolderSubtitle extends TrackMetadata { url: string; type: string; name: string; matchRank?: number }

export function subtitlePicker(root: HTMLElement, load: (refresh: boolean) => Promise<FolderSubtitle[]>, select: (item: FolderSubtitle) => void) {
  let overlay: HTMLDivElement | undefined;
  let restoreFocus: HTMLElement | null = null;
  const close = () => {
    overlay?.remove(); overlay = undefined;
    if (restoreFocus?.isConnected) restoreFocus.focus();
  };
  const open = () => {
    if (overlay) return;
    restoreFocus = document.activeElement as HTMLElement | null;
    const panel = overlay = document.createElement("div");
    panel.className = "synctv-subtitle-picker";
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", "添加同文件夹字幕");
    const style = document.createElement("style");
    style.textContent = `.synctv-subtitle-picker{position:absolute;inset:0;z-index:1200;background:#0009;display:flex;align-items:center;justify-content:center;padding:16px;color:#eee;font:14px/1.5 system-ui,sans-serif;text-align:left;box-sizing:border-box}.synctv-subtitle-picker section{background:#181b22;border:1px solid #ffffff30;border-radius:12px;width:600px;max-width:100%;max-height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px #0008}.synctv-subtitle-picker header{display:flex;align-items:center;gap:12px;padding:14px 16px}.synctv-subtitle-picker strong{flex:1;font-size:16px}.synctv-subtitle-picker button{border:1px solid #ffffff30;border-radius:6px;background:#ffffff09;color:inherit;padding:6px 12px;cursor:pointer;font:inherit}.synctv-subtitle-picker button:hover{background:#ffffff20}.synctv-subtitle-picker input{margin:0 16px 10px;padding:9px 11px;background:#101218;color:#fff;border:1px solid #ffffff40;border-radius:6px;font:inherit;min-width:0}.synctv-subtitle-picker button:focus-visible,.synctv-subtitle-picker input:focus-visible{outline:2px solid #38bdf8;outline-offset:1px}.synctv-subtitle-picker .subtitle-files{overflow:auto;padding:0 16px 14px;min-height:32px}.synctv-subtitle-picker .subtitle-files button{display:block;width:100%;text-align:left;margin-top:6px;overflow-wrap:anywhere;padding:10px 12px}.synctv-subtitle-picker p{padding:0 16px;margin:0 0 10px;color:#aeb6c4;font-size:12px}`;
    const section = document.createElement("section"), header = document.createElement("header");
    const title = document.createElement("strong"); title.textContent = "添加同文件夹字幕";
    const refresh = document.createElement("button"); refresh.type = "button"; refresh.textContent = "刷新";
    const exit = document.createElement("button"); exit.type = "button"; exit.textContent = "关闭"; exit.onclick = close;
    const search = document.createElement("input"); search.placeholder = "搜索字幕文件名"; search.setAttribute("aria-label", "搜索字幕文件名");
    const status = document.createElement("p"), list = document.createElement("div"); list.className = "subtitle-files";
    let files: FolderSubtitle[] = [];
    const render = () => {
      list.replaceChildren();
      const filtered = files.filter(item => item.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
      for (const item of filtered.slice(0, 200)) {
        const button = document.createElement("button"); button.type = "button";
        button.textContent = trackLabel(item, item.name) + (item.matchRank ? " · 同名匹配" : "");
        button.onclick = () => { select(item); close(); };
        list.append(button);
      }
      status.textContent = !files.length ? "当前文件夹没有 SRT、ASS、SSA 或 VTT 字幕" : !filtered.length ? "没有匹配的字幕文件" : filtered.length > 200 ? "仅显示前 200 项，请输入文件名筛选" : `${filtered.length} 个字幕文件`;
    };
    const fetchFiles = async (force: boolean) => {
      refresh.disabled = true; status.textContent = "正在读取字幕目录…";
      try {
        const result = await load(force);
        if (overlay !== panel) return;
        files = [...result].sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true, sensitivity: "base" })); render();
      } catch (error: any) { if (overlay === panel) status.textContent = error.message || "读取失败，请点击刷新重试"; }
      finally { refresh.disabled = false; }
    };
    refresh.onclick = () => { void fetchFiles(true); };
    search.oninput = render;
    header.append(title, refresh, exit); section.append(header, search, status, list); panel.append(style, section); root.append(panel);
    panel.addEventListener("click", event => { event.stopPropagation(); if (event.target === panel) close(); });
    panel.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") {
        const elements = [...panel.querySelectorAll<HTMLElement>("button:not(:disabled),input")];
        const next = event.shiftKey ? elements.at(-1) : elements[0];
        if (document.activeElement === (event.shiftKey ? elements[0] : elements.at(-1))) { event.preventDefault(); next?.focus(); }
      }
    });
    search.focus(); void fetchFiles(false);
  };
  return { open, close };
}
