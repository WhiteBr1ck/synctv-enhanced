import type { VideoInfo } from "./video-info";
export function codecName(codec = "") {
  if (/^(hvc1|hev1|hevc|h265)/i.test(codec)) return "HEVC";
  if (/^(avc1|avc3|h264)/i.test(codec)) return "H.264";
  if (/^(mp4a|aac)/i.test(codec)) return "AAC";
  if (/^(ec-3|eac3)/i.test(codec)) return "EAC3";
  if (/^(ac-3|ac3)/i.test(codec)) return "AC3";
  return codec.toUpperCase();
}
export function playbackSummary(
  source: { html?: string; url?: string; type?: string; playbackMode?: string },
  video: VideoInfo | undefined,
  audioTracks: any[] = [],
  range?: string,
  activeVideoCodec?: string,
  activeAudioCodec?: string,
  compatAudio?: { transcoded: boolean; codec?: string; channels?: number }
) {
  let query: Record<string, string> = {};
  try {
    query = Object.fromEntries(
      [...new URL(source.url || "", "http://local").searchParams].map(([k, v]) => [
        k.toLowerCase(),
        v
      ])
    );
  } catch {
    /* not a URL */
  }
  const compatibility = /^H\.264(?:\s|$)/i.test(source.html || "");
  const original =
    source.playbackMode === "direct" ||
    /原画|^raw$/i.test(source.html || "") ||
    !/^m3u8$|^mpd$/i.test(source.type || "");
  const rawCodec = codecName(video?.codec);
  const codec = compatibility ? "H.264" : codecName(activeVideoCodec) || rawCodec;
  const transcoded =
    compatibility ||
    (!original &&
      (query.allowvideostreamcopy === "false" ||
        /VideoCodec|VideoProfile|VideoLevel|VideoBitDepth|VideoRange|VideoResolution|VideoFramerate|ContainerBitrate|VideoBitrate/.test(
          query.transcodereasons || ""
        ) ||
        (codec && rawCodec && codec !== rawCodec)));
  const rawAudio = audioTracks.find((t) => t.default) || audioTracks[0];
  const audioCodec = compatAudio?.transcoded
    ? "AAC"
    : compatibility
      ? "AAC"
      : codecName(activeAudioCodec) ||
        (!original ? codecName(query.audiocodec?.split(",")[0]) : "") ||
        codecName(compatAudio?.codec || rawAudio?.codec);
  const audioTranscoded =
    !!compatAudio?.transcoded ||
    compatibility ||
    (!original &&
      (query.allowaudiostreamcopy === "false" ||
        !!(audioCodec && rawAudio?.codec && audioCodec !== codecName(rawAudio.codec))));
  const channels = audioTranscoded ? 2 : compatAudio?.channels || rawAudio?.channels;
  let depth = compatibility ? 8 : codec === rawCodec ? video?.bitDepth : undefined;
  if (!depth && /^(hvc1|hev1)\.2\./i.test(activeVideoCodec || "")) depth = 10;
  const value = compatibility
    ? "SDR"
    : transcoded
      ? undefined
      : video?.dynamicRange && video.dynamicRange !== "未标注"
        ? video.dynamicRange
        : range;
  const dynamicRange =
    value && /hdr|pq|hlg|dolby|dovi/i.test(value)
      ? `HDR${/dolby|dovi/i.test(value) ? " · Dolby Vision" : /hlg/i.test(value) ? " · HLG" : ""}`
      : value?.toUpperCase() === "SDR"
        ? "SDR"
        : "—";
  return {
    codec: codec || "—",
    transcoded,
    depth,
    dynamicRange,
    audio: `${audioTranscoded ? "转码" : "直通"} · ${audioCodec || "—"}${channels ? ` · ${channels} 声道` : ""}`
  };
}
