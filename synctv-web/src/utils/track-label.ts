const languages: Record<string, string> = {
  zh: "中文",
  chi: "中文",
  zho: "中文",
  chs: "简体中文",
  cht: "繁体中文",
  "zh-hans": "简体中文",
  "zh-hant": "繁体中文",
  en: "英语",
  eng: "英语",
  ja: "日语",
  jpn: "日语",
  ko: "韩语",
  kor: "韩语",
  fr: "法语",
  fre: "法语",
  fra: "法语",
  de: "德语",
  ger: "德语",
  deu: "德语"
};
export const languageName = (language = "") =>
  languages[language.toLowerCase()] || (language && language !== "und" ? language : "未知语言");
export interface TrackMetadata {
  origin?: string;
  language?: string;
  type?: string;
  codec?: string;
  title?: string;
  name?: string;
  index?: number;
  default?: boolean;
  forced?: boolean;
}
export function trackLabel(track: TrackMetadata, fallback: string) {
  const name = track.title || track.name || fallback;
  return `${track.origin === "external" ? "外挂" : "内封"} · ${languageName(track.language)} · ${(track.type || track.codec || "—").toUpperCase()} · ${name}${track.default ? "（默认）" : ""}${track.forced ? "（强制）" : ""}`;
}
export const escapeLabel = (label: string) =>
  label.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
