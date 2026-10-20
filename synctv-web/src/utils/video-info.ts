export interface VideoInfo {
  codec?: string;
  profile?: string;
  width?: number;
  height?: number;
  pixelFormat?: string;
  bitDepth?: number;
  frameRate?: number;
  bitRate?: number;
  dynamicRange?: string;
  colorPrimaries?: string;
  colorTransfer?: string;
  colorSpace?: string;
}

export function describePlayback(mode?: string, vendor?: string, name?: string, type?: string) {
  if (mode === "transcode") return "媒体服务器转换流（转封装 / 转码）";
  if (mode === "direct") return "媒体服务器直播放流";
  if (vendor === "alist" && name === "raw") return "AList / OpenList 原文件直通";
  if (vendor === "alist" && /^(m3u8|mpd)$/i.test(type || "")) return "AList / OpenList 预览流（处理方式未知）";
  return "直链播放（上游处理方式未知）";
}

// These are representative format checks, not a claim that the current bitstream
// can be decoded or that the display is currently outputting HDR.
export function basicDecodeType(video?: VideoInfo) {
  switch (video?.codec) {
    case "hevc": return video.bitDepth && video.bitDepth > 8
      ? 'video/mp4; codecs="hvc1.2.4.L153.B0"' : 'video/mp4; codecs="hvc1.1.6.L153.B0"';
    case "h264": return video.bitDepth && video.bitDepth > 8 ? undefined : 'video/mp4; codecs="avc1.640028"';
    case "vp9": return video.bitDepth && video.bitDepth > 8
      ? 'video/webm; codecs="vp09.02.10.10"' : 'video/webm; codecs="vp09.00.10.08"';
    case "av1": return video.bitDepth && video.bitDepth > 8
      ? 'video/mp4; codecs="av01.0.08M.10"' : 'video/mp4; codecs="av01.0.08M.08"';
    default: return undefined;
  }
}

export function describeVideo(video?: VideoInfo | null) {
  if (!video) return "暂无探测信息";
  return [video.codec?.toUpperCase(), video.profile, video.width && video.height ? `${video.width} × ${video.height}` : "",
    video.bitDepth ? `${video.bitDepth} bit` : "", video.frameRate ? `${Number(video.frameRate.toFixed(3))} fps` : ""]
    .filter(Boolean).join(" · ") || "未标注";
}
