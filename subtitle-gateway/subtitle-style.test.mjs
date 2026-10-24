import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleAss, normalizeAppearance } from '../synctv-web/src/utils/subtitle-style.ts';

test('ASS size adjustment preserves typography, positions, vectors and karaoke', () => {
  const ass = '[Script Info]\r\nPlayResX: 1920\r\nPlayResY: 1080\r\n[V4+ Styles]\r\nFormat: Name, Fontname, Fontsize, PrimaryColour, Outline, Alignment\r\nStyle: Main,Some Font,40,&H0000FF,2,2\r\n[Events]\r\nDialogue: 0,0:00:00.00,0:01:00.00,Main,,0,0,0,,{\\pos(100,200)\\fs30\\c&HFF0000&\\k20\\t(0,500,\\fs60)}Hello{\\p1}m 0 0 l 1 1{\\p0}';
  assert.equal(scaleAss(ass, 1), ass);
  const bigger = scaleAss(ass, 1.5);
  assert.match(bigger, /Some Font,60,&H0000FF,2,2/);
  assert.ok(bigger.includes('\\fs45')); assert.ok(bigger.includes('\\fs90'));
  for (const text of ['PlayResX: 1920', 'PlayResY: 1080', '\\pos(100,200)', '\\c&HFF0000&', '\\k20', '{\\p1}m 0 0 l 1 1{\\p0}']) assert.ok(bigger.includes(text));
  assert.equal(bigger.split('\r\n').length, ass.split('\r\n').length);
});

test('SSA column order and invalid stored preferences are handled', () => {
  assert.equal(scaleAss('[V4 Styles]\nFormat: Fontsize, Name\nStyle: 20,Default', 2), '[V4 Styles]\nFormat: Fontsize, Name\nStyle:40,Default');
  assert.deepEqual(normalizeAppearance({scale:100,lift:-10}), {scale:1,lift:0});
  assert.deepEqual(normalizeAppearance({scale:1.5,lift:10}), {scale:1.5,lift:10});
});
