import test from 'node:test';
import assert from 'node:assert/strict';
import { TransferMeter, formatTransferRate } from '../synctv-web/src/utils/transfer-meter.ts';

test('network speed includes HTTP and peer downloads plus uploads in bytes per second', () => {
  const meter = new TransferMeter(0);
  assert.equal(meter.rates(0), undefined);
  meter.update({ totalHTTPDownloaded: 1024, totalP2PDownloaded: 512, totalP2PUploaded: 256 }, 1000);
  assert.deepEqual(meter.rates(1000), { download: 1536 * 1024, upload: 256 * 1024 });
  assert.equal(formatTransferRate(meter.rates(1000).download), '1.50 MB/s');
  assert.equal(formatTransferRate(meter.rates(1000).upload), '256.0 KB/s');
  assert.equal(formatTransferRate(0), '0.0 KB/s');
});

test('network speed decays to zero during cached playback and resets between sources', () => {
  const meter = new TransferMeter(0);
  meter.update({ totalHTTPDownloaded: 1024, totalP2PDownloaded: 0, totalP2PUploaded: 0 }, 1000);
  assert.ok(meter.rates(1500).download > 0);
  assert.equal(meter.rates(5000).download, 0);
  meter.update({ totalHTTPDownloaded: 8, totalP2PDownloaded: 0, totalP2PUploaded: 0 }, 6000);
  assert.equal(meter.rates(6000).download, 0);
  meter.update({ totalHTTPDownloaded: 24, totalP2PDownloaded: 0, totalP2PUploaded: 0 }, 7000);
  assert.equal(meter.rates(7000).download, 16 * 1024);
  meter.reset(8000);
  assert.equal(meter.rates(8000), undefined);
});
