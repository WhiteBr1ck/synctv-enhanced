import Artplayer from "artplayer";
import type Hls from "hls.js";
import type { MediaPlayerClass } from "dashjs";
import {controlIcon,icon} from './icons';
import {trackLabel,escapeLabel} from '@/utils/track-label';
import {codecName} from '@/utils/playback-summary';

function uniqBy(array: any[], property: string) {
  const seen = new Map();
  return array.filter((item) => {
    const key = item[property];
    if (key === undefined) {
      return true;
    }
    return !seen.has(key) && seen.set(key, 1);
  });
}

interface QualityLevel {
  height?: number;
  name?: string;
  qualityIndex?: number;
  level?: number;
}

interface AudioTrack {
  name?: string;
  lang?: string;
  codec?:string;
  attrs?:any;
}

interface MediaProvider {
  getQualities(): QualityLevel[];
  getCurrentQuality(): number;
  setQuality(level: number | string): void;
  isAutoQuality?(): boolean;
  setAutoQuality?(enabled: boolean): void;

  getAudioTracks(): AudioTrack[];
  getCurrentAudioTrack(): number;
  setAudioTrack(trackId: number): void;
}

// Provider implementations
class HLSProvider implements MediaProvider {
  constructor(private hls: Hls) {}

  getQualities() {
    return this.hls.levels || [];
  }

  getCurrentQuality() {
    return this.hls.currentLevel;
  }

  setQuality(level: number) {
    this.hls.currentLevel = level;
  }

  getAudioTracks() {
    return this.hls.audioTracks || [];
  }

  getCurrentAudioTrack() {
    return this.hls.audioTrack;
  }

  setAudioTrack(trackId: number) {
    this.hls.audioTrack = trackId;
  }

  isAutoQuality() {
    return this.hls.currentLevel === -1;
  }

  setAutoQuality(enabled: boolean) {
    if (enabled) {
      this.hls.currentLevel = -1;
    }
  }
}

class DASHProvider implements MediaProvider {
  constructor(private dash: MediaPlayerClass) {}

  getQualities() {
    return this.dash.getRepresentationsByType("video");
  }

  getCurrentQuality() {
    return this.dash.getCurrentRepresentationForType("video")?.index || 0;
  }

  isAutoQuality() {
    return this.dash.getSettings().streaming?.abr?.autoSwitchBitrate?.video || false;
  }

  setQuality(level: number) {
    if (level === -1) {
      this.setAutoQuality(true);
    } else {
      this.setAutoQuality(false);
      this.dash.setRepresentationForTypeByIndex("video", level);
    }
  }

  setAutoQuality(enabled: boolean) {
    this.dash.updateSettings({
      streaming: {
        abr: {
          autoSwitchBitrate: {
            video: enabled
          }
        }
      }
    });
  }

  getAudioTracks() {
    return this.dash.getTracksFor("audio").map((track) => ({
      name: track.lang || track.id || undefined
    }));
  }

  getCurrentAudioTrack() {
    return this.dash.getCurrentTrackFor("audio")?.index || 0;
  }

  setAudioTrack(trackId: number) {
    this.dash.setCurrentTrack(this.dash.getTracksFor("audio")[trackId]);
  }
}

export default function artplayerPluginMediaControl() {
  return (art: Artplayer) => {
    const isMobile = Artplayer.utils.isMobile;

    function getProvider(): MediaProvider | null {
      if (art.hls) {
        return new HLSProvider(art.hls);
      }
      if ((art as any).dash) {
        return new DASHProvider((art as any).dash);
      }
      return null;
    }

    function updateQualityControl(provider: MediaProvider | null) {
      const qualities = provider?.getQualities() || [];
      const sources=art.plugins?.source?.entries?.() || [];

      const auto = "自动";
      const title = "画质";

      const getName = (level: QualityLevel) => {
        if (level.name) return level.name;
        return level.height ? `${level.height}P` : auto;
      };

      const currentQuality = provider?.getCurrentQuality();
      const isAuto = provider?.isAutoQuality?.() ?? currentQuality === -1;

      const selector:any[] = uniqBy(
        (qualities.length>1?qualities:[]).map((item, index) => ({
          html: getName(item),
          value: index,
          default: currentQuality === index && !isAuto
        })),
        "html"
      ).sort((a, b) => b.value - a.value);

      if (qualities.length>1&&provider?.setAutoQuality) {
        selector.push({
          html: auto,
          value: -1,
          default: isAuto
        });
      }
      const currentSource=art.plugins?.source?.currentSource?.();
      const sourceOptions=sources.length>1?sources.map((source:any,index:number)=>{
        const label=/H\.264/i.test(source.html)?'H.264 兼容':/原画|^raw$/i.test(source.html)?'原画':source.html==='默认'?(source.playbackMode==='transcode'?'自动处理':'默认'):`线路 ${index+1}`;
        return {html:label,sourceIndex:index,default:source.url===currentSource?.url};
      }):[];
      selector.unshift(...sourceOptions);

      updateControl("quality", title, selector, icon('quality'), (item: any) => {
        if(item.sourceIndex!==undefined){art.plugins.source.selectSource(item.sourceIndex);return controlIcon('quality',title);}
        provider?.setQuality(item.value);
        art.loading.show = true;
        art.notice.show = `${title}: ${item.html}`;
        return controlIcon('quality',title);
      });
    }

    function updateAudioControl(provider: MediaProvider) {
      const tracks = provider.getAudioTracks();
      if (!tracks.length) return;

      const title = "音轨";

      const getName = (track: AudioTrack) => {
        return track.name || "未知";
      };

      const currentTrack = provider.getCurrentAudioTrack();

      const selector = (
        tracks.map((item, index) => ({
          html: escapeLabel(trackLabel({origin:'embedded',language:item.lang||item.attrs?.LANGUAGE,codec:codecName(item.codec||item.attrs?.CODECS||art.hls?.levels?.[0]?.audioCodec),title:getName(item)},`音轨 ${index+1}`)),
          value: index,
          default: currentTrack === index
        }))
      );

      updateControl("audio", title, selector, icon('audio'), (item: any) => {
        provider.setAudioTrack(item.value);
        art.loading.show = true;
        art.notice.show = `${title}: ${item.html}`;
        return controlIcon('audio',title);
      });
    }

    function updateControl(
      name: string,
      title: string,
      selector: any[],
      icon: string,
      onSelect: (item: any) => string
    ) {
      if (!selector.length) {
        if (art.controls[name]) art.controls.remove(name);
        if (art.setting.find(name)) art.setting.remove(name);
        return;
      }

      const updateControls = () => {
        if (!isMobile || art.fullscreen) {
          art.controls.update({
            name,
            position: "right",
            html: controlIcon(name==='quality'?'quality':'audio',title),
            style: { padding: "0 10px" },
            selector,
            onSelect
          });
        } else if (art.controls[name]) {
          art.controls.remove(name);
        }
      };

      updateControls();

      art.setting.update({
        name,
        html: title,
        icon,
        width: 340,
        selector,
        onSelect:(item:any)=>{onSelect(item);return item.html;}
      });
    }

    function update() {
      const provider = getProvider();

      updateQualityControl(provider);
      if(provider)updateAudioControl(provider);
    }

    art.on("ready", update);
    art.on("restart", update);
    art.on('synctv:sources' as any,update);

    if (isMobile) {
      art.on("fullscreen", update);
    }

    return {
      name: "artplayerPluginMediaControl",
      update
    };
  };
}
