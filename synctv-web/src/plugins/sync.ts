import { useDebounceFn } from "@vueuse/core";
import { Message, MessageType, type Status } from "@/proto/message";
import type Artplayer from "artplayer";
import { ElNotification } from "element-plus";
import {
  loadSyncPreferences,
  shouldCorrectTime,
  syncPreferencesKey,
  syncModes,
  syncTolerances,
  syncIntervals
} from "@/utils/sync-preferences";
import { icon } from "./icons";

export interface PlaybackAccess {
  ownerControl: boolean;
  canControlPlayback: boolean;
}

export const newSyncPlugin =
  (
    sendStatus: (msg: Message) => boolean,
    initStatus: Status,
    dynamicCurrentExpireId: () => number,
    getAccess: () => PlaybackAccess = () => ({ ownerControl: false, canControlPlayback: true }),
    session: { paused: boolean } = { paused: false }
  ) =>
  (art: Artplayer) => {
    let disposed = false,
      ready = false,
      locallyPaused = session.paused;
    let preferences = loadSyncPreferences();
    let lastestSeek = 0,
      lastCorrection = "尚未发生同步跳转";
    let roomStatus = { ...initStatus },
      receivedAt = Date.now();
    let statusInterval: ReturnType<typeof setInterval> | undefined;
    let expireInterval: ReturnType<typeof setInterval> | undefined;
    let expectedRate = initStatus.playbackRate || 1;
    let applyingPlay = false,
      expectedNativePause = false;
    const { $player, $progress } = art.template;
    const badge = document.createElement("div");
    badge.className = "synctv-follow-status";
    badge.setAttribute("aria-live", "polite");
    $player.append(badge);
    const restricted = () => !getAccess().canControlPlayback;
    const publish = (message: Message) => !disposed && sendStatus(message);
    const currentStatus = (): Status => ({
      isPlaying: !art.video.paused,
      currentTime: art.currentTime,
      playbackRate: art.playbackRate
    });
    const roomNow = (): Status => ({
      ...roomStatus,
      currentTime:
        roomStatus.currentTime +
        (roomStatus.isPlaying ? ((Date.now() - receivedAt) / 1000) * roomStatus.playbackRate : 0)
    });
    const remember = (status: Status) => {
      roomStatus = { ...status };
      receivedAt = Date.now();
      expectedRate = status.playbackRate;
    };
    const updateAccess = () => {
      const access = getAccess();
      if (!restricted()) locallyPaused = false;
      session.paused = locallyPaused;
      $player.classList.toggle("synctv-playback-readonly", restricted());
      $progress.setAttribute("aria-disabled", String(restricted()));
      $progress.title = restricted() ? "跟随房间进度，无法拖动" : "";
      badge.textContent = locallyPaused
        ? "已暂停跟随"
        : access.ownerControl
          ? "房主控制"
          : restricted()
            ? "跟随房间"
            : "";
      badge.hidden = !badge.textContent;
      const rate = art.setting.find("playback-rate");
      if (rate?.$item) rate.$item.setAttribute("aria-disabled", String(restricted()));
      art.emit("synctv:follow-state" as any, { locallyPaused, restricted: restricted() });
    };
    const requestSync = () => {
      if (!publish(Message.create({ type: MessageType.SYNC }))) {
        art.notice.show = "连接尚未就绪，无法同步";
        return false;
      }
      locallyPaused = false;
      updateAccess();
      return true;
    };
    const playLocal = async () => {
      if (!art.video.paused) return;
      applyingPlay = true;
      try {
        await art.video.play();
      } catch {
        if (disposed) return;
        art.muted = true;
        try {
          await art.video.play();
          art.notice.show = "浏览器已静音，请手动开启声音";
        } catch {
          if (!disposed)
            ElNotification({
              title: "自动播放受限，请点击播放或设置中的立即同步",
              type: "warning"
            });
        }
      } finally {
        applyingPlay = false;
      }
    };
    const setAndNoPublishSeek = (seek: number, reason = "房间同步") => {
      lastestSeek = Date.now();
      if (art.option.isLive || Math.abs(art.currentTime - seek) < 2) return;
      lastCorrection = `${new Date().toLocaleTimeString()} · ${reason}：${art.currentTime.toFixed(1)} → ${seek.toFixed(1)} 秒`;
      art.currentTime = seek;
    };
    const setAndNoPublishRate = (rate: number) => {
      expectedRate = rate;
      if (!art.option.isLive && art.playbackRate !== rate) art.playbackRate = rate;
    };
    const setAndNoPublishPlay = () => playLocal();
    const setAndNoPublishPause = () => {
      if (!art.video.paused) {
        expectedNativePause = true;
        art.video.pause();
      }
    };
    const applyStatus = async (status: Status, reason?: string) => {
      if (disposed) return;
      setAndNoPublishRate(status.playbackRate);
      setAndNoPublishSeek(status.currentTime, reason);
      if (status.isPlaying) await playLocal();
      else setAndNoPublishPause();
    };
    const setAndNoPublishStatus = async (status: Status, reason?: string) => {
      remember(status);
      if (reason === "手动同步") {
        locallyPaused = false;
        updateAccess();
      }
      if (restricted() && locallyPaused) {
        art.video.pause();
        return;
      }
      await applyStatus(status, reason);
    };
    // Quality switches restore the viewer's local state, not the room's timeline.
    const restoreLocalStatus = (status: Status) =>
      applyStatus({ ...status, isPlaying: locallyPaused ? false : status.isPlaying }, "切换画质");
    const publishStatus = useDebounceFn(() => {
      if (disposed || restricted()) return;
      const status = currentStatus();
      remember(status);
      publish(
        Message.create({ type: MessageType.STATUS, timestamp: Date.now(), playbackStatus: status })
      );
    }, 500);
    const onPlay = () => {
      if (restricted()) {
        if (!requestSync()) setAndNoPublishPause();
        return;
      }
      publishStatus();
    };
    const onPause = () => {
      if (restricted()) {
        locallyPaused = true;
        updateAccess();
        return;
      }
      publishStatus();
    };
    const onSeek = () => {
      if (restricted()) {
        setAndNoPublishSeek(roomNow().currentTime, "恢复房间进度");
        art.notice.show = "当前为跟随模式，不能修改房间进度";
        return;
      }
      lastestSeek = Date.now();
      publishStatus();
    };
    const onRate = () => {
      if (art.playbackRate === expectedRate) return;
      if (restricted()) {
        art.playbackRate = expectedRate;
        return;
      }
      expectedRate = art.playbackRate;
      publishStatus();
    };
    const onNativePlay = () => {
      if (art.pip && !applyingPlay) onPlay();
    };
    const onNativePause = () => {
      if (expectedNativePause) {
        expectedNativePause = false;
        return;
      }
      if (art.pip) onPause();
    };
    const checkStatus = () => {
      if (
        disposed ||
        locallyPaused ||
        art.option.isLive ||
        Date.now() - lastestSeek < 10000 ||
        art.duration - art.currentTime < 5
      )
        return;
      publish(
        Message.create({
          type: MessageType.CHECK_STATUS,
          timestamp: Date.now(),
          playbackStatus: currentStatus()
        })
      );
    };
    const configureChecks = () => {
      clearInterval(statusInterval);
      if (ready && preferences.mode !== "off")
        statusInterval = setInterval(checkStatus, preferences.interval * 1000);
    };
    const savePreferences = () => {
      try {
        localStorage.setItem(syncPreferencesKey, JSON.stringify(preferences));
      } catch {
        /* storage unavailable */
      }
      configureChecks();
    };
    const automaticStatus = (status: Status) => {
      remember(status);
      if (locallyPaused || preferences.mode === "off") return false;
      const seek = shouldCorrectTime(art.currentTime, status.currentTime, preferences);
      const changed =
        seek || status.isPlaying !== !art.video.paused || status.playbackRate !== art.playbackRate;
      setAndNoPublishRate(status.playbackRate);
      if (seek) setAndNoPublishSeek(status.currentTime, "房间定时校准");
      if (status.isPlaying) void playLocal();
      else setAndNoPublishPause();
      return changed;
    };
    const blockSeek = (event: Event) => {
      if (!restricted()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const blockGesture = (event: TouchEvent) => {
      if (restricted() && event.touches.length === 1) blockSeek(event);
    };
    const blockKeys = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      if (!restricted() || !art.isFocus || target?.closest?.("input,textarea,[contenteditable]"))
        return;
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.code)) blockSeek(event);
    };
    const progressEvents = ["pointerdown", "mousedown", "touchstart", "touchmove", "click"];
    for (const event of progressEvents)
      $progress.addEventListener(event, blockSeek, { capture: true, passive: false });
    art.video.addEventListener("touchmove", blockGesture, { capture: true, passive: false });
    document.addEventListener("keydown", blockKeys, true);
    const blockRateMenu = (event: Event) => {
      if (restricted() && (event.target as Element)?.closest?.('[data-name="playback-rate"]'))
        blockSeek(event);
    };
    const settingsElement = $player.querySelector?.(".art-settings");
    settingsElement?.addEventListener("click", blockRateMenu, true);
    art.on("synctv:playback-access" as any, updateAccess);
    art.on("setting", updateAccess);
    art.on("play", onPlay);
    art.on("pause", onPause);
    art.on("seek", onSeek);
    art.on("video:ratechange", onRate);
    art.on("video:play", onNativePlay);
    art.on("video:pause", onNativePause);
    art.setting.add({
      name: "syncPlugin",
      html: "立即同步",
      icon: icon("sync"),
      onClick: () => {
        requestSync();
        art.setting.show = false;
        return "";
      }
    });
    art.setting.add({
      name: "sync-preferences",
      html: "同步设置",
      icon: icon("clock"),
      width: 300,
      selector: [
        {
          html: "定时校准方式",
          icon: icon("sync"),
          tooltip: syncModes.find((mode) => mode.value === preferences.mode)!.html,
          selector: syncModes.map((mode) => ({
            ...mode,
            default: mode.value === preferences.mode
          })),
          onSelect(item: any) {
            preferences.mode = item.value;
            savePreferences();
            return item.html;
          }
        },
        {
          html: "进度容差",
          icon: icon("tolerance"),
          tooltip: `${preferences.tolerance} 秒`,
          selector: syncTolerances.map((value) => ({
            html: `${value} 秒`,
            value,
            default: value === preferences.tolerance
          })),
          onSelect(item: any) {
            preferences.tolerance = item.value;
            savePreferences();
            return item.html;
          }
        },
        {
          html: "检查间隔",
          icon: icon("interval"),
          tooltip: `${preferences.interval} 秒`,
          selector: syncIntervals.map((value) => ({
            html: `${value} 秒`,
            value,
            default: value === preferences.interval
          })),
          onSelect(item: any) {
            preferences.interval = item.value;
            savePreferences();
            return item.html;
          }
        }
      ]
    });
    art.once("ready", async () => {
      if (disposed) return;
      await applyStatus(
        locallyPaused
          ? { ...initStatus, isPlaying: false }
          : art.option.isLive
            ? { ...initStatus, isPlaying: true }
            : initStatus
      );
      if (disposed) return;
      ready = true;
      configureChecks();
      expireInterval = setInterval(
        () =>
          publish(
            Message.create({
              type: MessageType.EXPIRED,
              timestamp: Date.now(),
              expirationId: dynamicCurrentExpireId()
            })
          ),
        10000
      );
    });
    updateAccess();
    art.on("destroy", () => {
      disposed = true;
      clearInterval(statusInterval);
      clearInterval(expireInterval);
      art.off("play", onPlay);
      art.off("pause", onPause);
      art.off("seek", onSeek);
      art.off("video:ratechange", onRate);
      art.off("video:play", onNativePlay);
      art.off("video:pause", onNativePause);
      art.off("synctv:playback-access" as any, updateAccess);
      art.off("setting", updateAccess);
      for (const event of progressEvents) $progress.removeEventListener(event, blockSeek, true);
      art.video.removeEventListener("touchmove", blockGesture, true);
      document.removeEventListener("keydown", blockKeys, true);
      badge.remove();
      settingsElement?.removeEventListener("click", blockRateMenu, true);
    });
    return {
      name: "syncPlugin",
      setAndNoPublishSeek,
      setAndNoPublishPlay,
      setAndNoPublishPause,
      setAndNoPublishRate,
      setAndNoPublishStatus,
      restoreLocalStatus,
      currentStatus,
      lastCorrection: () => lastCorrection,
      automaticStatus,
      automaticSettings: () =>
        `${syncModes.find((mode) => mode.value === preferences.mode)!.html} · 容差 ${preferences.tolerance} 秒 · 每 ${preferences.interval} 秒检查`,
      requestSync,
      isLocallyPaused: () => locallyPaused,
      updateAccess
    };
  };
