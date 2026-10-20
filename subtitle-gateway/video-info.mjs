const number = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : undefined;

export function videoInfo(probe) {
  const stream = probe.streams?.find(item => item.codec_type === 'video' && !item.disposition?.attached_pic);
  if (!stream) return null;
  const sideData = stream.side_data_list || [];
  const dolby = sideData.find(item => /dovi|dolby vision/i.test(item.side_data_type || ''));
  const hdr10Plus = sideData.some(item => /2094.40|hdr10\+/i.test(item.side_data_type || ''));
  const transfer = stream.color_transfer;
  let dynamicRange = '未标注';
  if (dolby) dynamicRange = `Dolby Vision${number(dolby.dv_profile) ? ` P${dolby.dv_profile}` : ''}`;
  else if (hdr10Plus) dynamicRange = 'HDR10+';
  else if (transfer === 'smpte2084') dynamicRange = 'HDR / PQ';
  else if (transfer === 'arib-std-b67') dynamicRange = 'HDR / HLG';
  else if (['bt709', 'smpte170m', 'smpte240m', 'iec61966-2-1', 'bt470m', 'bt470bg', 'gamma22', 'gamma28', 'bt2020-10', 'bt2020-12'].includes(transfer)) dynamicRange = 'SDR';
  const pixelFormat = stream.pix_fmt || '';
  const depth = number(stream.bits_per_raw_sample)
    || number(/(?:p|gbrp|gray)(\d+)(?:le|be)?$/.exec(pixelFormat)?.[1])
    || (/^(?:yuv\w*p|nv12|nv21|rgb24|bgr24|rgba|bgra|gray)$/.test(pixelFormat) ? 8 : undefined);
  const rate = String(stream.avg_frame_rate || stream.r_frame_rate || '').split('/').map(Number);
  const frameRate = rate.length === 2 ? number(rate[0] / rate[1]) : number(rate[0]);
  // Return a small allowlist. Probe output can include signed URLs, tags and attachments.
  return { codec: stream.codec_name, profile: stream.profile, width: number(stream.width), height: number(stream.height),
    pixelFormat, bitDepth: depth, frameRate, bitRate: number(stream.bit_rate), dynamicRange,
    colorPrimaries: stream.color_primaries, colorTransfer: transfer, colorSpace: stream.color_space };
}
