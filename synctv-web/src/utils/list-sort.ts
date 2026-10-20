export interface SortItem { name: string; isDir?: boolean; type?: string; size?: number | string; modified?: number | string; created?: number | string; }
const names = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function fileType(item: SortItem): string {
  if (item.isDir) return '';
  const dot = item.name.lastIndexOf('.');
  return (dot > 0 && dot < item.name.length - 1 ? item.name.slice(dot + 1) : item.type || '').toLowerCase();
}

export function numericMetadata(value: unknown, date = false): number {
  if (value === undefined || value === null || value === '') return NaN;
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  return date && typeof value === 'string' ? Date.parse(value) : NaN;
}

export function compareItems(a: SortItem, b: SortItem, sort: string): number {
  if (!!a.isDir !== !!b.isDir) return a.isDir ? -1 : 1;
  const direction = sort.endsWith('-desc') ? -1 : 1;
  const field = sort.split('-')[0];
  if (field === 'type') {
    const left = fileType(a), right = fileType(b);
    if (!!left !== !!right) return left ? -1 : 1;
    const order = names.compare(left, right);
    if (order) return order * direction;
  } else if (field !== 'name') {
    const left = numericMetadata(a[field as 'size' | 'modified' | 'created'], field !== 'size');
    const right = numericMetadata(b[field as 'size' | 'modified' | 'created'], field !== 'size');
    const hasLeft = Number.isFinite(left);
    const hasRight = Number.isFinite(right);
    if (hasLeft !== hasRight) return hasLeft ? -1 : 1;
    if (hasLeft && hasRight && left !== right) return (left! - right!) * direction;
  }
  return names.compare(a.name || '', b.name || '') * (field === 'name' ? direction : 1);
}

// Sort the complete directory before slicing the requested page. Sorting only
// the visible ten entries would put later episodes on the wrong page.
export async function sortedPage<T, R extends { items: T[]; total: number }>(
  load: (page: number, max: number) => Promise<R>, page: number, max: number,
  sort: string, describe: (item: T) => SortItem,
  decorate?: (items: T[]) => Promise<void>
): Promise<R> {
  if (sort === 'original') return load(page, max);
  const batchSize = 10000;
  const first = await load(1, batchSize);
  if (first.total > 10000) throw new Error('目录超过 10000 项，请进入子目录后排序');
  const items = [...(first.items || [])];
  for (let next = 2; items.length < first.total; next++) {
    const result = await load(next, batchSize);
    if (!result.items.length) break;
    items.push(...result.items);
  }
  if (decorate) await decorate(items);
  items.sort((a, b) => compareItems(describe(a), describe(b), sort));
  return { ...first, items: items.slice((page - 1) * max, page * max) };
}
