import Artplayer from "artplayer";
import artplayerPluginAss from "../src/plugins/artplayer-plugin-ass";
import { artplayerSubtitle } from "../src/plugins/subtitle";

const response = await fetch('/api/room/movie/current');
const { data: { movie } } = await response.json();
const art = new Artplayer({
  container: '#player', url: movie.base.url, type: 'mp4', autoSize: false,
  autoplay: true, muted: true, loop: true, setting: true, fullscreen: true,
  subtitleOffset: true, subtitle: { encoding: 'utf-8', escape: false },
  moreVideoAttr: { playsInline: true },
  plugins: [artplayerPluginAss({}), artplayerSubtitle({}, movie.base.embeddedSubtitleSource)]
});
art.on('ready', () => document.querySelector('#status')!.textContent = '播放器已就绪；使用播放器右下角“字幕”菜单切换 ASS / SRT 或关闭字幕。');
art.on('error', () => document.querySelector('#status')!.textContent = '播放发生错误');
