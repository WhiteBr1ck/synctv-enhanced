export interface SubtitleAppearance { scale: number; lift: number; color: string; }
export const subtitleAppearanceKey = "synctv:subtitle-appearance";
export const subtitleScales = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
export const subtitleLifts = [0, 5, 10, 15, 20];

export function normalizeAppearance(value: Partial<SubtitleAppearance> = {}): SubtitleAppearance {
  return { scale: subtitleScales.includes(value.scale!) ? value.scale! : 1,
    lift: subtitleLifts.includes(value.lift!) ? value.lift! : 0,
    color: /^#[a-f\d]{6}$/i.test(value.color || '') ? value.color! : '#ffffff' };
}

export function loadSubtitleAppearance(): SubtitleAppearance {
  try { return normalizeAppearance(JSON.parse(localStorage.getItem(subtitleAppearanceKey) || "{}") || {}); }
  catch { return normalizeAppearance(); }
}

// Change font sizes in the original script rather than zooming its canvas.
// Keep colors, fonts, placement, drawing commands, karaoke and animation tags.
// Always transform the original text so repeated adjustments never accumulate.
export function scaleAss(content: string, scale: number): string {
  if (scale === 1) return content;
  const number = (value: number) => String(Math.round(value * 100) / 100);
  let styles = false, fontIndex = -1;
  return content.replace(/[^\r\n]+/g, line => {
    if (/^\s*\[/.test(line)) { styles = /^\s*\[V4\+? Styles\]/i.test(line); fontIndex = -1; }
    if (styles && /^\s*Format:/i.test(line)) fontIndex = line.slice(line.indexOf(":") + 1).split(",").findIndex(field => field.trim().toLowerCase() === "fontsize");
    if (styles && fontIndex >= 0 && /^\s*Style:/i.test(line)) {
      const colon = line.indexOf(":");
      const fields = line.slice(colon + 1).split(",");
      const size = Number(fields[fontIndex]);
      if (Number.isFinite(size) && size > 0) fields[fontIndex] = number(size * scale);
      return line.slice(0, colon + 1) + fields.join(",");
    }
    if (/^\s*Dialogue:/i.test(line)) return line.replace(/\{[^}]*\}/g, tags =>
      tags.replace(/\\fs([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g, (_, size: string) =>
        `\\fs${size.startsWith("+") ? "+" : ""}${number(Number(size) * scale)}`));
    return line;
  });
}
