import { debounces } from "@/utils";
import { useDebounceFn } from "@vueuse/core";
import { type WatchStopHandle } from "vue";
import { Message, MessageType, Status } from "@/proto/message";
import Artplayer from "artplayer";
import { ElNotification } from "element-plus";
import { loadSyncPreferences, shouldCorrectTime, syncPreferencesKey, syncModes, syncTolerances, syncIntervals } from "@/utils/sync-preferences";
import {icon,controlIcon} from './icons';

const artPlay = async (art: Artplayer) => {
  let retry = false;
  await art.video.play().catch(() => {
    art.muted = true;
    retry = true;
  });
  if (retry)
    await art.video
      .play()
      .then(() => {
        ElNotification({
          title: "温馨提示",
          type: "info",
          message: "由于浏览器限制，播放器已静音，请手动开启声音"
        });
      })
      .catch((e) => {
        ElNotification({
          title: "自动播放失败，请手动点击同步按钮",
          type: "error",
          message: e
        });
      });
};

interface syncPlugin {
  name: string;
  setAndNoPublishSeek: (seek: number, reason?: string) => void;
  setAndNoPublishPlay: () => void;
  setAndNoPublishPause: () => void;
  setAndNoPublishRate: (rate: number) => void;
  setAndNoPublishStatus: (status: Status, reason?: string) => void;
  currentStatus: () => Status;
  lastCorrection: () => string;
  automaticStatus: (status: Status) => boolean;
  automaticSettings: () => string;
}

const debounceTime = 500;

const newSyncControl = (art: Artplayer, publishStatus: (msg: Message) => boolean) => {
  const syncControl = () => {
    publishStatus(
      Message.create({
        type: MessageType.SYNC
      })
    );
  };

  art.controls.add({
    name: "syncPlugin",
    html: controlIcon('sync','同步'),
    position: "right",
    click: syncControl
  });

  art.setting.add({
    name: "syncPlugin",
    html: "立即同步",icon:icon('sync'),
    selector: [
      {
        default: true,
        html: "点击同步"
      }
    ],
    onSelect: syncControl
  });
};

export const newSyncPlugin = (
  sendStatus: (msg: Message) => boolean,
  initStatus: Status,
  dynamicCurrentExpireId: () => number
) => {
  return (art: Artplayer): syncPlugin => {
    let disposed=false;
    const publishStatus=(message:Message)=>!disposed&&sendStatus(message);
    const playingStatusDebounce = debounces(debounceTime);

    let lastestSeek = 0;
    let lastCorrection = "尚未发生同步跳转";
    let preferences = loadSyncPreferences();
    let statusInterval: ReturnType<typeof setInterval> | undefined;
    let ready = false;
    const configureChecks = () => {
      clearInterval(statusInterval);
      statusInterval = undefined;
      if (ready && preferences.mode !== "off") statusInterval = setInterval(checkStatus, preferences.interval * 1000);
    };
    const savePreferences = () => {
      try { localStorage.setItem(syncPreferencesKey, JSON.stringify(preferences)); } catch { /* storage unavailable */ }
      configureChecks();
    };

    const publishSeek = () => {
      console.groupCollapsed("广播视频空降");
      console.log("seek:", art.currentTime);
      console.log("rate:", art.playbackRate);
      console.log("playing:", !art.video.paused);
      console.groupEnd();
      publishStatus(
        Message.create({
          type: MessageType.STATUS,
          timestamp: Date.now(),
          playbackStatus: {
            isPlaying: !art.video.paused,
            currentTime: art.currentTime,
            playbackRate: art.playbackRate
          }
        })
      );
    };

    const __publishSeekDebounce = useDebounceFn(publishSeek, debounceTime);

    const publishSeekDebounce = function () {
      lastestSeek = Date.now();
      __publishSeekDebounce();
    };

    const setAndNoPublishSeek = (seek: number, reason = "房间同步") => {
      lastestSeek = Date.now();
      if (art.option.isLive || Math.abs(art.currentTime - seek) < 2) return;
      const mode=reason==='房间定时校准'?`（${preferences.mode==='forward'?'仅向前':'双向'}）`:'';
      lastCorrection = `${new Date().toLocaleTimeString()} · ${reason}${mode}：${art.currentTime.toFixed(1)} → ${seek.toFixed(1)} 秒`;
      console.groupCollapsed("设置seek(非广播)");
      console.log("seek:", seek);
      console.log("rate:", art.playbackRate);
      console.log("playing:", !art.video.paused);
      console.groupEnd();
      art.currentTime = seek;
    };

    const publishPlay = () => {
      console.groupCollapsed("广播视频播放");
      console.log("seek:", art.currentTime);
      console.log("rate:", art.playbackRate);
      console.log("playing:", !art.video.paused);
      console.groupEnd();
      publishStatus(
        Message.create({
          type: MessageType.STATUS,
          timestamp: Date.now(),
          playbackStatus: {
            isPlaying: true,
            currentTime: art.currentTime,
            playbackRate: art.playbackRate
          }
        })
      );
    };

    const publishPlayDebounce = playingStatusDebounce(publishPlay);

    const setAndNoPublishPlay = async () => {
      if (!art.video.paused) return;
      console.groupCollapsed("设置播放(非广播)");
      console.log("seek:", art.currentTime);
      console.log("rate:", art.playbackRate);
      console.log("playing:", !art.video.paused);
      console.groupEnd();
      await artPlay(art);
    };

    const publishPause = () => {
      console.groupCollapsed("广播视频暂停");
      console.log("seek:", art.currentTime);
      console.log("rate:", art.playbackRate);
      console.log("playing:", !art.video.paused);
      console.groupEnd();
      publishStatus(
        Message.create({
          type: MessageType.STATUS,
          timestamp: Date.now(),
          playbackStatus: {
            isPlaying: false,
            currentTime: art.currentTime,
            playbackRate: art.playbackRate
          }
        })
      );
    };

    const publishPauseDebounce = playingStatusDebounce(publishPause);

    const setAndNoPublishPause = () => {
      if (art.video.paused) return;
      console.groupCollapsed("设置暂停(非广播)");
      console.log("seek:", art.currentTime);
      console.log("rate:", art.playbackRate);
      console.log("playing:", !art.video.paused);
      console.groupEnd();
      art.video.pause();
    };

    const publishRate = () => {
      console.groupCollapsed("广播视频倍速");
      console.log("seek:", art.currentTime);
      console.log("rate:", art.playbackRate);
      console.log("playing:", !art.video.paused);
      console.groupEnd();
      publishStatus(
        Message.create({
          type: MessageType.STATUS,
          timestamp: Date.now(),
          playbackStatus: {
            isPlaying: !art.video.paused,
            currentTime: art.currentTime,
            playbackRate: art.playbackRate
          }
        })
      );
    };

    const setAndNoPublishRate = (rate: number) => {
      if (art.option.isLive || art.playbackRate === rate) return;
      art.off("video:ratechange", publishRate);
      art.once("video:ratechange", () => {
        art.on("video:ratechange", publishRate);
      });
      console.groupCollapsed("设置倍速(非广播)");
      console.log("rate:", rate);
      console.groupEnd();
      art.playbackRate = rate;
    };

    const checkStatus = () => {
      // 距离上一次seek超过10s后才会检查seek
      if (
        Date.now() - lastestSeek < 10000 ||
        art.option.isLive ||
        art.duration - art.currentTime < 5
      ) {
        return;
      }
      console.groupCollapsed("检查状态");
      console.log("seek:", art.currentTime);
      console.log("rate:", art.playbackRate);
      console.log("playing:", !art.video.paused);
      console.groupEnd();
      publishStatus(
        Message.create({
          type: MessageType.CHECK_STATUS,
          timestamp: Date.now(),
          playbackStatus: {
            isPlaying: !art.video.paused,
            currentTime: art.currentTime,
            playbackRate: art.playbackRate
          }
        })
      );
    };

    const checkExpire = () => {
      console.groupCollapsed("检查过期");
      console.log("expireId:", dynamicCurrentExpireId());
      console.groupEnd();
      publishStatus(
        Message.create({
          type: MessageType.EXPIRED,
          timestamp: Date.now(),
          expirationId: dynamicCurrentExpireId()
        })
      );
    };

    const setAndNoPublishStatus = async (status: Status, reason?: string) => {
      console.groupCollapsed("设置状态(非广播)");
      console.log("seek:", status.currentTime);
      console.log("rate:", status.playbackRate);
      console.log("playing:", status.isPlaying);
      console.groupEnd();
      if (!art.option.isLive) {
        setAndNoPublishRate(status.playbackRate);
        setAndNoPublishSeek(status.currentTime, reason);
      }
      status.isPlaying ? await setAndNoPublishPlay() : setAndNoPublishPause();
    };

    const currentStatus = (): Status => {
      return {
        isPlaying: !art.video.paused,
        currentTime: art.currentTime,
        playbackRate: art.playbackRate
      };
    };

    // Only CHECK_STATUS uses these local preferences. Deliberate room actions
    // and the manual Sync button must still be applied to every participant.
    const automaticStatus = (status: Status) => {
      if (preferences.mode === "off") return false;
      const seek = shouldCorrectTime(art.currentTime, status.currentTime, preferences);
      const changed = seek || status.isPlaying !== !art.video.paused || status.playbackRate !== art.playbackRate;
      setAndNoPublishRate(status.playbackRate);
      if (seek && !(preferences.mode === 'forward' && status.currentTime < art.currentTime)) setAndNoPublishSeek(status.currentTime, "房间定时校准");
      if (status.isPlaying) void setAndNoPublishPlay(); else setAndNoPublishPause();
      return changed;
    };
    const automaticSettings = () => `${syncModes.find(mode => mode.value === preferences.mode)!.html} · 容差 ${preferences.tolerance} 秒 · 每 ${preferences.interval} 秒检查`;

    const intervals: number[] = [];
    const watchers: WatchStopHandle[] = [];
    art.on("destroy", () => {
      disposed=true;
      clearInterval(statusInterval);
      intervals.forEach((interval) => {
        clearInterval(interval);
      });
      watchers.forEach((watcher) => {
        watcher();
      });
    });

    if (!art.option.isLive) {
      art.once("ready", async () => {
        console.groupCollapsed("同步状态");
        console.log("seek:", initStatus.currentTime);
        console.log("rate:", initStatus.playbackRate);
        console.log("playing:", initStatus.isPlaying);
        console.groupEnd();
        art.currentTime = initStatus.currentTime;
        art.playbackRate = initStatus.playbackRate;
        if (initStatus.isPlaying) {
          await artPlay(art);
        }
        if(disposed)return;

        ready = true;
        configureChecks();
        intervals.push(setInterval(checkExpire, 10000));

        newSyncControl(art, publishStatus);
        art.setting.add({ name: "sync-preferences", html: "同步设置",icon:icon('clock'), width: 300, selector: [
          { html: "定时校准方式",icon:icon('sync'), tooltip: syncModes.find(mode => mode.value === preferences.mode)!.html,
            selector: syncModes.map(mode => ({ ...mode, default: mode.value === preferences.mode })),
            onSelect(item: any) { preferences.mode = item.value; savePreferences(); return item.html; } },
          { html: "进度容差",icon:icon('tolerance'), tooltip: `${preferences.tolerance} 秒`,
            selector: syncTolerances.map(value => ({ html: `${value} 秒`, value, default: value === preferences.tolerance })),
            onSelect(item: any) { preferences.tolerance = item.value; savePreferences(); return item.html; } },
          { html: "检查间隔",icon:icon('interval'), tooltip: `${preferences.interval} 秒`,
            selector: syncIntervals.map(value => ({ html: `${value} 秒`, value, default: value === preferences.interval })),
            onSelect(item: any) { preferences.interval = item.value; savePreferences(); return item.html; } }
        ] });

        art.on("play", publishPlayDebounce);

        // 视频暂停
        art.on("pause", publishPauseDebounce);

        // 空降
        art.on("seek", publishSeekDebounce);

        // 倍速
        art.on("video:ratechange", publishRate);

        art.on("destroy", () => {
          art.off("play", publishPlayDebounce);
          art.off("pause", publishPauseDebounce);
          art.off("seek", publishSeekDebounce);
          art.off("video:ratechange", publishRate);
        });
      });
    } else {
      art.once("ready", () => {
        setAndNoPublishPlay();
        intervals.push(setInterval(checkExpire, 10000));
      });
    }

    return {
      name: "syncPlugin",
      setAndNoPublishSeek,
      setAndNoPublishPlay,
      setAndNoPublishPause,
      setAndNoPublishRate,
      setAndNoPublishStatus,
      currentStatus,
      lastCorrection: () => lastCorrection,
      automaticStatus,
      automaticSettings
    };
  };
};
