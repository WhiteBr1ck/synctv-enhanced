import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimedText, activeTextCues } from '../synctv-web/src/plugins/timed-text.ts';

test('SRT loaded in the middle of a video retains timestamps and displays the active cue', () => {
  const cues = parseTimedText('\uFEFF1\r\n00:00:23,149 --> 00:00:25,150\r\n开场\r\n\r\n2\r\n00:10:50,000 --> 00:10:55,000\r\n中段字幕\r\n第二行\r\n');
  assert.equal(cues[1].startTime, 650);
  assert.equal(activeTextCues(cues, 652)[0].text, '中段字幕\n第二行');
  assert.equal(activeTextCues(cues, 649).length, 0);
  assert.equal(activeTextCues(cues, 655).length, 0);
});
test('WebVTT cue identifiers and cue settings do not change timing', () => {
  const cues = parseTimedText('WEBVTT\n\ncaption-id\n10:50.000 --> 10:55.500 align:start\n<i>Caption</i>');
  assert.equal(cues[0].startTime, 650);
  assert.equal(cues[0].endTime, 655.5);
  assert.equal(cues[0].text, '<i>Caption</i>');
});
test('only safe basic formatting survives subtitle HTML input', () => {
  const cues = parseTimedText('1\n00:00:00,000 --> 00:00:01,000\n<img src=x onerror=alert(1)><b>Text</b>');
  assert.equal(cues[0].text.includes('<img'), false);
  assert.equal(cues[0].text.includes('<b>Text</b>'), true);
});
