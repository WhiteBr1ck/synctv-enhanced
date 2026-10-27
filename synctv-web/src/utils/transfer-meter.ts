export interface TransferTotals {
  totalHTTPDownloaded: number;
  totalP2PDownloaded: number;
  totalP2PUploaded: number;
}

// SwarmCloud reports cumulative KiB, including HTTP traffic with P2P disabled.
// Measure both transports over a short window; a cached video can legitimately
// play at zero network speed once downloads stop.
export class TransferMeter {
  private samples: { at: number; download: number; upload: number }[] = [];
  private observed = false;

  constructor(now = performance.now()) { this.reset(now); }

  reset(now = performance.now()) {
    this.samples = [{ at: now, download: 0, upload: 0 }];
    this.observed = false;
  }

  update(totals: TransferTotals, now = performance.now()) {
    const values = [totals.totalHTTPDownloaded, totals.totalP2PDownloaded, totals.totalP2PUploaded];
    if (!values.every(value => Number.isFinite(value) && value >= 0)) return;
    const download = (totals.totalHTTPDownloaded + totals.totalP2PDownloaded) * 1024;
    const upload = totals.totalP2PUploaded * 1024;
    const previous = this.samples.at(-1)!;
    if (download < previous.download || upload < previous.upload) this.reset(now);
    this.observed = true;
    this.append({ at: now, download, upload });
  }

  rates(now = performance.now()) {
    if (!this.observed) return undefined;
    this.append({ ...this.samples.at(-1)!, at: now });
    const first = this.samples[0], last = this.samples.at(-1)!;
    const seconds = (last.at - first.at) / 1000;
    return {
      download: seconds > 0 ? (last.download - first.download) / seconds : 0,
      upload: seconds > 0 ? (last.upload - first.upload) / seconds : 0
    };
  }

  private append(sample: { at: number; download: number; upload: number }) {
    if (sample.at === this.samples.at(-1)!.at) this.samples[this.samples.length - 1] = sample;
    else this.samples.push(sample);
    while (this.samples.length > 2 && this.samples[1].at <= sample.at - 3000) this.samples.shift();
  }
}

export function formatTransferRate(bytes: number) {
  const value = Math.max(0, bytes);
  return value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(2)} MB/s` : `${(value / 1024).toFixed(1)} KB/s`;
}
