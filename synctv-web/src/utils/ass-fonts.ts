// Some releases share subset fonts across episodes but keep an episode's old
// subset aliases in ASS. Resolve only explicit original-family matches.
const familyGroups = [
  ["FZZhunYuan-M02", "方正准圆_GBK"],
  ["FZShaoEr-M11", "方正少儿_GBK"],
  ["FZCuQian-M17", "方正粗倩_GBK"],
  ["FZXiaoBiaoSong-B05", "方正小标宋_GBK"],
  ["FZDaBiaoSong-B06", "fzdbs_GBK"],
  ["華康竹風體W4", "DFChu-W4-WIN-BF"],
  ["華康正顏楷體W5", "正顏楷體w5"],
  ["華康新綜藝體W7", "新綜藝體W7"]
];
const normalize = (name: string) => name.trim().toLowerCase().replace(/[\s_-]+/g, "");
const families = new Map(familyGroups.flatMap(group => group.map(name => [normalize(name), normalize(group[0])] as const)));
const family = (name: string) => families.get(normalize(name)) || normalize(name);

export function resolveAssSubsetFonts(content: string, files: { name: string }[] = []): string {
  const originals = new Map<string, string>();
  for (const match of content.matchAll(/^\s*;\s*Font Subset:\s*([a-z\d]{8})\s*-\s*(.+?)\s*$/gmi)) {
    originals.set(normalize(match[1]), match[2]);
  }
  const available = new Set<string>();
  const candidates = new Map<string, Set<string>>();
  for (const file of files) {
    const match = /^(.+)\.([a-z\d]{8})\.(?:ttf|otf)$/i.exec(file.name.split(/[\\/]/).pop() || "");
    if (!match) continue;
    available.add(normalize(match[2]));
    const key = family(match[1]);
    if (!candidates.has(key)) candidates.set(key, new Set());
    candidates.get(key)!.add(match[2]);
  }
  const resolve = (name: string) => {
    if (available.has(normalize(name))) return name;
    const original = originals.get(normalize(name)) || name;
    const matches = candidates.get(family(original));
    return matches?.size === 1 ? [...matches][0] : name;
  };
  let styles = false, fontIndex = -1;
  return content.replace(/[^\r\n]+/g, line => {
    if (/^\s*\[/.test(line)) { styles = /^\s*\[V4\+? Styles\]/i.test(line); fontIndex = -1; }
    if (styles && /^\s*Format:/i.test(line)) fontIndex = line.slice(line.indexOf(":") + 1).split(",").findIndex(field => field.trim().toLowerCase() === "fontname");
    if (styles && fontIndex >= 0 && /^\s*Style:/i.test(line)) {
      const colon = line.indexOf(":"), fields = line.slice(colon + 1).split(",");
      if (fields[fontIndex]) fields[fontIndex] = fields[fontIndex].replace(/^(\s*)(.*?)(\s*)$/, (_, start, name, end) => start + resolve(name) + end);
      return line.slice(0, colon + 1) + fields.join(",");
    }
    if (/^\s*(Dialogue|Comment):/i.test(line)) return line.replace(/\{[^}]*\}/g, tags => tags.replace(/\\fn([^\\}]*)/gi, (_, name) => `\\fn${resolve(name)}`));
    return line;
  });
}
