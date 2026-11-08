type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenContainer = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function containerFullscreen(
  player: FullscreenContainer,
  doc: FullscreenDocument,
  callbacks: { change: (active: boolean) => void; inputExit: () => void }
) {
  let wasActive = false,
    explicitExit = false,
    editing = false,
    destroyed = false;
  const active = () => (doc.fullscreenElement || doc.webkitFullscreenElement) === player;
  const supported = () => !!(player.requestFullscreen || player.webkitRequestFullscreen);
  const focus = (event: Event) => {
    if (active() && (event.target as Element)?.matches?.("input:not([type=range]),textarea"))
      editing = true;
  };
  const changed = () => {
    if (destroyed) return;
    const entered = active(),
      left = wasActive && !entered;
    wasActive = entered;
    callbacks.change(entered);
    if (
      left &&
      !explicitExit &&
      (editing || player.querySelector("input:not([type=range]):focus,textarea:focus"))
    )
      callbacks.inputExit();
    if (!entered) {
      editing = false;
      explicitExit = false;
    }
  };
  doc.addEventListener("fullscreenchange", changed);
  doc.addEventListener("webkitfullscreenchange", changed);
  player.addEventListener("focusin", focus);
  return {
    active,
    supported,
    async enter() {
      if (destroyed) return;
      explicitExit = false;
      editing = false;
      const request = player.requestFullscreen || player.webkitRequestFullscreen;
      if (!request) throw new Error("Container fullscreen unavailable");
      await request.call(player);
    },
    async exit() {
      if (!active()) return;
      explicitExit = true;
      if (doc.exitFullscreen) await doc.exitFullscreen();
      else await doc.webkitExitFullscreen?.();
    },
    destroy() {
      destroyed = true;
      doc.removeEventListener("fullscreenchange", changed);
      doc.removeEventListener("webkitfullscreenchange", changed);
      player.removeEventListener("focusin", focus);
    }
  };
}
