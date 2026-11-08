const paths = {
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4V5Zm5 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4V5Zm5 4 6 6m0-6-6 6"/>',
  settings:
    '<path d="m9 3-.5 2-2 1-2-.5-2 3 1.5 1.5v3L2.5 15l2 3 2-.5 2 1 .5 2h4l.5-2 2-1 2 .5 2-3-1.5-1.5v-3L20.5 9l-2-3-2 .5-2-1-.5-2H9Z"/><circle cx="11.5" cy="12" r="3"/>',
  theater:
    '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M16 4v16m3-11h1m-1 3h1m-1 3h1"/>',
  webFullscreen:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18m-14-3h.01m3 0h.01M7 12v5h10v-5"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  pip: '<rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1"/>',
  stats: '<path d="M4 20V4m0 16h17M8 16v-4m5 4V7m5 9V9"/>',
  danmuku:
    '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="m6 18-1 3 5-3M7 9h10m-10 4h6"/>',
  danmukuSettings:
    '<path d="M21 10V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h1l-1 3 5-3h2M7 9h7m-7 4h3m5 0v8m5-8v8m-7-6h4m1 3h4"/>',
  network: '<path d="M7 3v16m-4-4 4 4 4-4M17 21V5m-4 4 4-4 4 4"/>',
  danmukuOff:
    '<path d="m3 3 18 18M3 8v8a2 2 0 0 0 2 2h1l-1 3 5-3h6M8 4h11a2 2 0 0 1 2 2v9M12 9h5m-10 4h2"/>',
  send: '<path d="m3 3 18 9-18 9 4-9-4-9Zm4 9h14"/>',
  subtitle:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h4M7 14h3m4-4h3m-4 4h4"/>',
  audio: '<path d="M4 13v-1a8 8 0 0 1 16 0v1M4 12H3v7h4v-7H4Zm16 0h1v7h-4v-7h3Z"/>',
  quality:
    '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8m-4-4v4M7 9v5m4-5v5M7 11h4m4-2v5h3V9h-3Z"/>',
  sync: '<path d="M20 7v5h-5M4 17v-5h5m-4-4a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/>',
  size: '<path d="M3 6h12M9 6v15m-4 0h8m3-10h6m-3 0v10m-2 0h4"/>',
  position: '<path d="m9 6 3-3 3 3m-3-3v9m-3 6 3 3 3-3m-3 3v-9M3 15h4m10 0h4M3 9h4m10 0h4"/>',
  color:
    '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="9" r="1"/><circle cx="15" cy="8" r="1"/><circle cx="17" cy="14" r="1"/><path d="M5 16h5l2 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  tolerance: '<path d="M4 5v14m16-14v14M7 12h10m-7-3-3 3 3 3m4-6 3 3-3 3"/>',
  interval:
    '<path d="M9 3h6m-3 0v3m6 1 2-2"/><circle cx="12" cy="14" r="7"/><path d="M12 10v4l2 2"/>'
};
export type PlayerIcon = keyof typeof paths;
export const icon = (name: PlayerIcon) =>
  `<svg class="synctv-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
export const controlIcon = (name: PlayerIcon, label: string) =>
  `<span class="synctv-icon-button" title="${label}" aria-label="${label}">${icon(name)}</span>`;
