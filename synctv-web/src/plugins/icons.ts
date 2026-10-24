const paths = {
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
