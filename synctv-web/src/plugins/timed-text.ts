export interface TextCue {
  startTime: number;
  endTime: number;
  text: string;
}

function seconds(value: string): number {
  const parts = value.replace(',', '.').split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

// SRT and WebVTT timestamps remain relative to the original video, including
// when a subtitle is selected after playback has already reached the middle.
export function parseTimedText(input: string): TextCue[] {
  const cues: TextCue[] = [];
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (const block of text.split(/\n[\t ]*\n/)) {
    const lines = block.split('\n');
    const index = lines.findIndex(line => line.includes('-->'));
    if (index < 0 || /^\s*(NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;
    const match = /^\s*((?:\d+:)?\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[,.]\d{1,3})/.exec(lines[index]);
    if (!match) continue;
    const startTime = seconds(match[1]), endTime = seconds(match[2]);
    if (!Number.isFinite(startTime) || endTime <= startTime) continue;
    // Artplayer renders cue text as HTML. Escape source text, retaining only
    // the basic formatting tags supported by both SRT and WebVTT.
    const caption = lines.slice(index + 1).join('\n').trimEnd().replace(/\{\\[^}]*\}/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/&lt;(\/?)(b|i|u)&gt;/gi, '<$1$2>');
    cues.push({ startTime, endTime, text: caption });
  }
  return cues.sort((a, b) => a.startTime - b.startTime);
}

export function activeTextCues(cues: TextCue[], time: number): TextCue[] {
  return cues.filter(cue => cue.startTime <= time && time < cue.endTime);
}
