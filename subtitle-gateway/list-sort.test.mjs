import test from 'node:test';
import assert from 'node:assert/strict';
import { sortedPage, compareItems } from '../synctv-web/src/utils/list-sort.ts';

test('natural sorting preserves folder priority and numeric episode order', () => {
  const items = [{name:'E10'}, {name:'E2'}, {name:'Z',isDir:true}, {name:'E1'}];
  assert.deepEqual(items.toSorted((a,b)=>compareItems(a,b,'name-asc')).map(x=>x.name), ['Z','E1','E2','E10']);
  assert.deepEqual(items.toSorted((a,b)=>compareItems(a,b,'name-desc')).map(x=>x.name), ['Z','E10','E2','E1']);
});

test('file type sorting groups extensions case-insensitively and keeps folders first', () => {
  const items = [{name:'Episode 10.MKV'}, {name:'clip.mp4'}, {name:'README'},
    {name:'Z',isDir:true}, {name:'caption.ass'}, {name:'Episode 2.mkv'}];
  assert.deepEqual(items.toSorted((a,b)=>compareItems(a,b,'type-asc')).map(x=>x.name),
    ['Z','caption.ass','Episode 2.mkv','Episode 10.MKV','clip.mp4','README']);
  assert.deepEqual(items.toSorted((a,b)=>compareItems(a,b,'type-desc')).map(x=>x.name),
    ['Z','clip.mp4','Episode 2.mkv','Episode 10.MKV','caption.ass','README']);
});
test('sorts all directory pages before paginating the result', async () => {
  const items = Array.from({length:123},(_,i)=>({name:`Episode ${123-i}`,size:i,modified:1000-i}));
  const pages = [];
  const result = await sortedPage(async(page,max)=>{
    pages.push(page); return {total:items.length,items:items.slice((page-1)*max,page*max)};
  },2,10,'name-asc',item=>item);
  assert.deepEqual(pages,[1,2]);
  assert.equal(result.total,123);
  assert.equal(result.items[0].name,'Episode 11');
  assert.equal(result.items.at(-1).name,'Episode 20');
});
test('modification date and size sort numerically with missing metadata last', () => {
  const items = [{name:'old',modified:1,size:200},{name:'new',modified:3,size:10},{name:'unknown'}];
  assert.deepEqual(items.toSorted((a,b)=>compareItems(a,b,'modified-desc')).map(x=>x.name),['new','old','unknown']);
  assert.deepEqual(items.toSorted((a,b)=>compareItems(a,b,'size-desc')).map(x=>x.name),['old','new','unknown']);
});
test('AList ISO timestamps and numeric strings sort using their actual values', () => {
  const items = [{name:'Anime',modified:'2026-10-17T01:34:20+08:00',size:'9'},
    {name:'Movie',modified:'2026-10-08T03:36:54+08:00',size:'100'},
    {name:'TV',modified:'2026-08-09T04:15:44+08:00',size:'20'}];
  assert.deepEqual(items.toSorted((a,b)=>compareItems(a,b,'modified-asc')).map(x=>x.name),['TV','Movie','Anime']);
  assert.deepEqual(items.toSorted((a,b)=>compareItems(a,b,'size-desc')).map(x=>x.name),['Movie','TV','Anime']);
});
