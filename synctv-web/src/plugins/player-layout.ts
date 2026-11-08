import type Artplayer from "artplayer";
import { icon, controlIcon, type PlayerIcon } from "./icons";
import { containerFullscreen } from "@/utils/container-fullscreen";

export function artplayerLayout(theater: { active: () => boolean; toggle: () => void }) {
  return (art: Artplayer) => {
    const { $player } = art.template;
    const $controlsCenter = $player.querySelector<HTMLDivElement>(".art-controls-center")!;
    const removers: (() => void)[] = [];
    let destroyed = false;
    const listen = (
      target: EventTarget,
      name: string,
      fn: EventListener,
      options?: AddEventListenerOptions
    ) => {
      target.addEventListener(name, fn, options);
      removers.push(() => target.removeEventListener(name, fn, options));
    };
    const native = containerFullscreen($player, document, {
      change(active) {
        $player.classList.toggle("art-fullscreen", active);
        updateLayout();
      },
      inputExit() {
        art.fullscreenWeb = true;
        art.notice.show = "已切换网页全屏，可继续输入；点击全屏可返回";
      }
    });
    const nativeFullscreen = native.active;
    for (const [selector, label] of [
      [".art-icon-play", "播放"],
      [".art-icon-pause", "暂停"]
    ]) {
      const element = art.controls.playAndPause.querySelector<HTMLElement>(selector);
      if (!element) continue;
      element.setAttribute("role", "button");
      element.setAttribute("tabindex", "0");
      element.setAttribute("aria-label", label);
      listen(element, "keydown", (event) => {
        const key = event as KeyboardEvent;
        if (key.key === "Enter" || key.key === " ") {
          key.preventDefault();
          element.click();
        }
      });
    }
    const exitNative = async () => {
      await native.exit();
    };
    const button = (
      name: string,
      label: string,
      glyph: PlayerIcon,
      index: number,
      click: () => unknown
    ) => {
      art.controls.add({ name, position: "right", index, html: controlIcon(glyph, label), click });
      const element = art.controls[name];
      element.setAttribute("role", "button");
      element.setAttribute("tabindex", "0");
      element.setAttribute("aria-label", label);
      listen(element, "keydown", (event) => {
        const key = event as KeyboardEvent;
        if (key.key === "Enter" || key.key === " ") {
          key.preventDefault();
          element.click();
        }
      });
      return element;
    };
    const nativeButton = button("native-fullscreen", "全屏", "fullscreen", 70, async () => {
      if (nativeFullscreen()) {
        await exitNative();
        return;
      }
      if (!native.supported()) {
        art.notice.show = "当前浏览器不支持播放器全屏，请使用网页全屏";
        return;
      }
      if (theater.active()) theater.toggle();
      if (art.fullscreenWeb) art.fullscreenWeb = false;
      try {
        await native.enter();
      } catch {
        if (!destroyed) art.notice.show = "无法进入全屏，请使用网页全屏";
      }
    });
    button("theater", "剧场模式", "theater", 50, async () => {
      await exitNative();
      if (art.fullscreenWeb) art.fullscreenWeb = false;
      theater.toggle();
      updateLayout();
    });
    const webButton = button("web-fullscreen", "网页全屏", "webFullscreen", 60, async () => {
      await exitNative();
      if (theater.active()) theater.toggle();
      art.fullscreenWeb = !art.fullscreenWeb;
    });

    // Own the mount point so the upstream plugin cannot move the input outside
    // the player at mobile widths or on keyboard-induced viewport changes.
    const mountDanmuku = () => {
      const plugin = art.plugins?.artplayerPluginDanmuku;
      if (!plugin) return;
      if (plugin.option.width !== 0) plugin.config({ width: 0 });
      plugin.mount($controlsCenter);
    };
    const danmukuButtons = [
      [".apd-toggle-on", "danmuku"],
      [".apd-toggle-off", "danmukuOff"],
      [".apd-config > svg", "settings"],
      [".apd-style > svg", "color"]
    ] as const;
    mountDanmuku();
    const styleOptions = $player.querySelector<HTMLElement>(".apd-style-panel-inner");
    const danmukuOptions = $player.querySelector<HTMLElement>(".apd-config-panel-inner");
    if (styleOptions && danmukuOptions) {
      styleOptions.classList.remove("apd-style-panel-inner");
      styleOptions.classList.add("synctv-danmuku-style-settings");
      danmukuOptions.append(styleOptions);
      $player.querySelector<HTMLElement>(".apd-style")?.setAttribute("hidden", "");
    }
    for (const [selector, glyph] of danmukuButtons) {
      const old = $player.querySelector(selector);
      if (old) {
        const template = document.createElement("template");
        template.innerHTML = icon(glyph);
        const replacement = template.content.firstElementChild!;
        if (old.classList.contains("apd-toggle-on")) replacement.classList.add("apd-toggle-on");
        if (old.classList.contains("apd-toggle-off")) replacement.classList.add("apd-toggle-off");
        replacement.classList.add("apd-icon");
        old.replaceWith(replacement);
      }
    }
    for (const [selector, label] of [
      [".apd-toggle", "弹幕开关"],
      [".apd-config", "弹幕设置"]
    ]) {
      const element = $player.querySelector<HTMLElement>(selector);
      if (!element) continue;
      element.setAttribute("role", "button");
      element.setAttribute("tabindex", "0");
      element.setAttribute("aria-label", label);
      if (selector !== ".apd-toggle")
        listen(element, "click", (event) => {
          if ((event.target as Element)?.closest(".apd-config-panel,.apd-style-panel")) return;
          element.classList.toggle("synctv-panel-open");
        });
      listen(element, "keydown", (event) => {
        const key = event as KeyboardEvent;
        if (key.target !== element) return;
        if (key.key === "Enter" || key.key === " ") {
          key.preventDefault();
          element.click();
        }
        if (key.key === "Escape") element.classList.remove("synctv-panel-open");
      });
    }
    listen($player, "pointerdown", (event) => {
      for (const panel of $player.querySelectorAll(".synctv-panel-open"))
        if (!panel.contains(event.target as Node)) panel.classList.remove("synctv-panel-open");
      if (!(event.target as Element)?.closest(".art-control-volume"))
        $player.querySelector(".synctv-volume-panel")?.classList.remove("synctv-volume-open");
    });

    // Touch-capable volume control; iOS may still require the device volume keys.
    const volumePanel = document.createElement("div");
    volumePanel.className = "synctv-volume-panel";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    slider.setAttribute("aria-label", "音量");
    volumePanel.append(slider);
    art.controls.volume.append(volumePanel);
    const muteButton = document.createElement("button");
    muteButton.className = "synctv-mute";
    muteButton.type = "button";
    art.controls.volume.prepend(muteButton);
    const volume = () => {
      slider.value = String(art.volume);
      muteButton.innerHTML = icon(art.muted ? "mute" : "volume");
      muteButton.setAttribute("aria-label", art.muted ? "取消静音" : "静音");
    };
    listen(muteButton, "click", () => {
      art.muted = !art.muted;
      volumePanel.classList.toggle("synctv-volume-open");
    });
    listen(slider, "input", () => {
      art.muted = false;
      art.volume = Number(slider.value);
    });
    listen(slider, "change", () => {
      if (Math.abs(art.volume - Number(slider.value)) > 0.05)
        art.notice.show = "请使用设备音量键调节音量";
    });
    art.on("video:volumechange", volume);
    volume();
    art.setting.add({
      name: "picture-in-picture",
      html: "画中画",
      icon: icon("pip"),
      switch: false,
      onSwitch: async () => {
        try {
          if (document.pictureInPictureEnabled) {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else {
              art.state = "pip";
              await art.video.requestPictureInPicture();
            }
          } else if ("webkitSetPresentationMode" in art.video) art.pip = !art.pip;
          else {
            art.notice.show = "当前浏览器不支持画中画";
            return false;
          }
          if (theater.active()) theater.toggle();
        } catch {
          art.notice.show = "当前浏览器无法开启画中画";
        }
        art.setting.show = false;
        return !!art.pip;
      }
    });
    art.setting.add({
      name: "statistics",
      html: "统计信息",
      icon: icon("stats"),
      switch: false,
      onSwitch: () => {
        art.info.show = !art.info.show;
        art.setting.show = false;
        return art.info.show;
      }
    });
    const infoState = (show: boolean) => {
      const item = art.setting.find("statistics");
      if (item) item.switch = show;
    };
    const pipState = (show: boolean) => {
      const item = art.setting.find("picture-in-picture");
      if (item) item.switch = !!show;
    };
    art.on("info", infoState);
    art.on("pip", pipState);
    const closeInfo = $player.querySelector<HTMLElement>(".art-info-close");
    if (closeInfo) {
      closeInfo.setAttribute("role", "button");
      closeInfo.setAttribute("tabindex", "0");
      closeInfo.setAttribute("aria-label", "关闭统计信息");
      listen(closeInfo, "keydown", (event) => {
        const key = event as KeyboardEvent;
        if (key.key === "Enter" || key.key === " ") {
          key.preventDefault();
          art.info.show = false;
        }
      });
    }
    art.controls.setting.setAttribute("role", "button");
    art.controls.setting.setAttribute("tabindex", "0");
    art.controls.setting.setAttribute("aria-label", "设置");
    listen(art.controls.setting, "keydown", (event) => {
      const key = event as KeyboardEvent;
      if (key.key === "Enter" || key.key === " ") {
        key.preventDefault();
        art.controls.setting.click();
      }
    });
    const layoutSize = () => {
      if (destroyed) return;
      $player.classList.toggle("synctv-compact", $player.clientWidth < 820);
      $player.style.setProperty(
        "--synctv-danmuku-panel-height",
        `${Math.max(100, $player.clientHeight - ($player.clientWidth < 820 ? 130 : 90))}px`
      );
      art.emit("resize");
    };
    const observer = new ResizeObserver(layoutSize);
    observer.observe($player);
    function updateLayout() {
      if (destroyed) return;
      mountDanmuku();
      webButton.setAttribute("aria-label", art.fullscreenWeb ? "退出网页全屏" : "网页全屏");
      nativeButton.setAttribute("aria-label", nativeFullscreen() ? "退出全屏" : "全屏");
      art.controls.theater?.setAttribute("aria-pressed", String(theater.active()));
    }
    art.on("fullscreenWeb", updateLayout);
    art.on("fullscreen", updateLayout);
    art.on("synctv:theater" as any, updateLayout);
    $player.classList.add("synctv-unified-player");
    updateLayout();
    layoutSize();
    queueMicrotask(() => {
      if (!destroyed) updateLayout();
    });
    art.on("destroy", () => {
      destroyed = true;
      native.destroy();
      observer.disconnect();
      removers.forEach((remove) => remove());
      art.off("video:volumechange", volume);
      art.off("info", infoState);
      art.off("pip", pipState);
      art.off("fullscreenWeb", updateLayout);
      art.off("fullscreen", updateLayout);
      art.off("synctv:theater" as any, updateLayout);
    });
    return { name: "playerLayout" };
  };
}
