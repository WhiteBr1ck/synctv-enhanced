import type Artplayer from "artplayer";

type Device = Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">;

export function isAppleTouchDevice(device: Device = navigator) {
  return /iPad|iPhone|iPod/i.test(device.userAgent) ||
    (/Macintosh|MacIntel/i.test(`${device.userAgent} ${device.platform}`) && device.maxTouchPoints > 1);
}

export function playerFullscreenOptions(device: Device = navigator) {
  // Custom controls request container fullscreen only. Never fall back to the
  // native video UI, which cannot carry the chat/ASS renderer and text input.
  return { fullscreen: false, fullscreenWeb: false, autoOrientation: false };
}

export default function artplayerPluginDanmukuInput(device: Device = navigator) {
  return (art: Artplayer) => {
    const { $player } = art.template;
    const input = $player.querySelector<HTMLInputElement>(".apd-input");
    const send = $player.querySelector<HTMLElement>(".apd-send");
    const appleTouch = isAppleTouchDevice(device);
    const viewport = window.visualViewport;
    // Artplayer mutates this flag in its click handler; its typings mark it readonly.
    const focusState = art as unknown as { isInput: boolean };
    const listeners: (() => void)[] = [];
    let composing = false;
    let destroyed = false;

    if (appleTouch) $player.classList.add("synctv-apple-touch");

    function listen(target: EventTarget, names: string | string[], listener: EventListener, options?: AddEventListenerOptions) {
      for (const name of Array.isArray(names) ? names : [names]) {
        target.addEventListener(name, listener, options);
        listeners.push(() => target.removeEventListener(name, listener, options));
      }
    }

    function isTextEntry(el: Element | null) {
      if (!el) return false;
      if (el.tagName === "TEXTAREA") return true;
      if (el.tagName !== "INPUT") return false;
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return !["range", "checkbox", "radio", "button", "submit", "reset"].includes(type);
    }

    function isDanmukuTarget(target: EventTarget | null) {
      if (!target) return false;
      if (target === input || target === send) return true;
      const node = target as Node & { closest?: (selector: string) => unknown };
      if (input && typeof input.contains === "function" && input.contains(node)) return true;
      if (send && typeof send.contains === "function" && send.contains(node)) return true;
      return typeof node.closest === "function" && !!node.closest(".apd-input, .apd-send");
    }

    function updateViewport() {
      if (destroyed) return;
      // Move only the controls. Resizing the video would also resize ASS canvases.
      const inset = appleTouch && (art.fullscreenWeb || art.fullscreen) && input && document.activeElement === input && viewport
        ? Math.max(0, $player.getBoundingClientRect().bottom - viewport.offsetTop - viewport.height)
        : 0;
      $player.style.setProperty("--synctv-keyboard-inset", `${inset}px`);
    }

    function updateFocus() {
      if (destroyed || !input) return;
      const editing = document.activeElement === input;
      $player.classList.toggle("synctv-danmuku-editing", editing);
      if (editing) {
        focusState.isInput = true;
        art.controls.show = true;
      } else {
        const active = document.activeElement as Element | null;
        focusState.isInput = !!active && $player.contains(active) && isTextEntry(active);
      }
      updateViewport();
    }

    function updateFullscreenLabel() {
      if (!art.fullscreenWeb && !art.fullscreen && input && document.activeElement === input) input.blur();
      if (appleTouch) {
        art.controls.fullscreenWeb?.setAttribute("aria-label", art.fullscreenWeb ? "退出全屏" : "全屏");
      }
      updateViewport();
    }

    if (input) {
      input.setAttribute("enterkeyhint", "send");
      input.setAttribute("aria-label", "弹幕内容");
      listen(input, "focus", updateFocus);
      listen(input, "blur", () => queueMicrotask(updateFocus));
      listen(input, "compositionstart", () => { composing = true; });
      listen(input, "compositionend", () => { composing = false; });
      // Do not submit an IME candidate as a message. Leave the browser's default
      // touch/focus handling intact so iPadOS can open its software keyboard.
      listen(input, "keypress", (event) => {
        const key = event as KeyboardEvent;
        if (key.isComposing || composing || key.keyCode === 229) event.stopImmediatePropagation();
      }, { capture: true });
    }

    if (send) {
      send.setAttribute("role", "button");
      send.setAttribute("tabindex", "0");
      send.setAttribute("aria-label", "发送弹幕");
      listen(send, "pointerdown", (event) => {
        // Keep the keyboard and button in place until the tap becomes a click.
        if (document.activeElement === input) event.preventDefault();
      }, { passive: false });
      listen(send, "keydown", (event) => {
        const key = event as KeyboardEvent;
        if (!key.isComposing && (key.key === "Enter" || key.key === " ")) {
          event.preventDefault();
          send.click();
        }
      });
    }

    if (art.template.$controls) {
      const toolbar = art.template.$bottom || art.template.$controls;
      listen(toolbar, "pointerdown", (event) => {
        if (!input || document.activeElement !== input || isDanmukuTarget(event.target)) return;
        if (appleTouch) {
          // Keep the lifted toolbar steady until click lands on the tapped control.
          event.preventDefault();
        } else {
          input.blur();
        }
      }, { passive: false });
      if (toolbar !== $player) {
        listen(toolbar, "click", (event) => {
          if (input && document.activeElement === input && !isDanmukuTarget(event.target)) {
            input.blur();
          }
          queueMicrotask(updateFocus);
        });
      }
    }

    listen($player, "pointerdown", (event) => {
      if (!appleTouch && input && document.activeElement === input && !isDanmukuTarget(event.target)) {
        input.blur();
      }
    });
    listen($player, "click", (event) => {
      if (input && document.activeElement === input && !isDanmukuTarget(event.target)) {
        input.blur();
      }
      queueMicrotask(updateFocus);
    });

    const keepControls = (show: boolean) => {
      if (!show && input && document.activeElement === input) art.controls.show = true;
    };
    art.on("control", keepControls);
    art.on("fullscreenWeb", updateFullscreenLabel);
    if (appleTouch && viewport) {
      listen(viewport, ["resize", "scroll"], updateViewport);
      listen(window, "resize", updateViewport);
    }
    updateFullscreenLabel();
    art.on("destroy", () => {
      destroyed = true;
      art.off("control", keepControls);
      art.off("fullscreenWeb", updateFullscreenLabel);
      listeners.forEach(remove => remove());
      $player.classList.remove("synctv-apple-touch", "synctv-danmuku-editing");
      $player.style.removeProperty("--synctv-keyboard-inset");
    });

    return { name: "artplayerPluginDanmukuInput" };
  };
}
