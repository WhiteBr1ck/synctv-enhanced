import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSyncPreferences, shouldCorrectTime } from '../synctv-web/src/utils/sync-preferences.ts';

test('automatic synchronization respects forward-only mode and per-viewer tolerance', () => {
  const normal=normalizeSyncPreferences();
  assert.equal(shouldCorrectTime(100,85,normal),true);
  assert.equal(shouldCorrectTime(100,95,normal),false);
  const forward=normalizeSyncPreferences({mode:'forward',tolerance:15,interval:30});
  assert.equal(shouldCorrectTime(100,85,forward),false);
  assert.equal(shouldCorrectTime(100,110,forward),false);
  assert.equal(shouldCorrectTime(100,120,forward),true);
  assert.equal(shouldCorrectTime(100,500,{...forward,mode:'off'}),false);
  assert.equal(shouldCorrectTime(NaN,500,normal),false);
});
test('invalid stored settings revert to existing server-compatible defaults', () => {
  assert.deepEqual(normalizeSyncPreferences({mode:'unknown',tolerance:-5,interval:0}),{mode:'bidirectional',tolerance:10,interval:10});
});
