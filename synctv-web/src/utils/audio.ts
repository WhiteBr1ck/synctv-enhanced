export interface EmbeddedAudioTrack {
  index: number;
  codec: string;
  channels?: number;
  language: string;
  title: string;
  default: boolean;
  url: string;
}

export function audioLabel(track: EmbeddedAudioTrack) {
  const languages: Record<string, string> = { jpn: "日语", ja: "日语", eng: "英语", en: "英语", zho: "中文", chi: "中文", zh: "中文" };
  return [languages[track.language] || track.language || `音轨 ${track.index}`, track.codec.toUpperCase(),
    track.channels ? `${track.channels} 声道` : ""].filter(Boolean).join(" · ");
}

export function audioMime(codec: string) {
  const codecs: Record<string, string> = { aac: 'audio/mp4; codecs="mp4a.40.2"', eac3: 'audio/mp4; codecs="ec-3"',
    ac3: 'audio/mp4; codecs="ac-3"', mp3: 'audio/mpeg', opus: 'audio/webm; codecs="opus"', flac: 'audio/flac', vorbis: 'audio/webm; codecs="vorbis"' };
  return codecs[codec];
}

export function audioCorrection(videoTime: number, audioTime: number, origin: number, rate: number) {
  const expected = Math.max(0, videoTime - origin);
  const drift = expected - audioTime;
  return { expected, drift, rate: rate * (1 + Math.max(-0.04, Math.min(0.04, drift * 0.1))) };
}
