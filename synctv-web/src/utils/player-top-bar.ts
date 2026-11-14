export const DANMUKU_TOP_SAFE_AREA = 48;

export function danmukuSafeAreaOptions() {
  return {
    margin: [DANMUKU_TOP_SAFE_AREA, "25%"] as [number, `${number}%`],
    MARGIN: {
      min: 0,
      max: 3,
      steps: [
        { name: "1/4", value: [DANMUKU_TOP_SAFE_AREA, "68%"] as [number, `${number}%`] },
        { name: "半屏", value: [DANMUKU_TOP_SAFE_AREA, "50%"] as [number, `${number}%`] },
        { name: "3/4", value: [DANMUKU_TOP_SAFE_AREA, "25%"] as [number, `${number}%`] },
        { name: "满屏", value: [DANMUKU_TOP_SAFE_AREA, 12] as [number, number] }
      ]
    }
  };
}

export function ensureTopBadgesContainer($player: HTMLElement): HTMLDivElement {
  const existing = Array.from($player.children || []).find(
    (child) =>
      child.classList?.contains("synctv-top-badges") ||
      (typeof child.className === "string" &&
        child.className.split(/\s+/).includes("synctv-top-badges"))
  ) as HTMLDivElement | undefined;
  if (existing) return existing;
  const doc = $player.ownerDocument || document;
  const container = doc.createElement("div");
  container.className = "synctv-top-badges";
  $player.append(container);
  return container;
}

export function mountTopRightBadge(
  $player: HTMLElement,
  badge: HTMLElement,
  position: "start" | "end"
): HTMLDivElement {
  const container = ensureTopBadgesContainer($player);
  if (position === "start") {
    if (typeof container.prepend === "function") container.prepend(badge);
    else (container as unknown as { children?: HTMLElement[] }).children?.unshift(badge);
  } else container.append(badge);
  return container;
}
