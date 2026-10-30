import test from 'node:test';import assert from 'node:assert/strict';
import {resolveAssSubsetFonts} from '../synctv-web/src/utils/ass-fonts.ts';
const ass='; Font Subset: DR7UOBXG - FZZhunYuan-M02\r\n[V4+ Styles]\r\nFormat: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,Alignment\r\nStyle: Default,DR7UOBXG,50,&H00FFFFFF,&H00D22FAB,2\r\n[Events]\r\nDialogue: 0,0:00:03.00,0:00:07.00,Default,,0,0,0,,{\\fnDR7UOBXG\\fs42\\pos(100,200)}Test\r\n';
test('binds an obsolete subset alias to the attached subset of the same original font',()=>{
 const result=resolveAssSubsetFonts(ass,[{name:'方正准圆_GBK.DLY1TJDA.ttf'}]);
 assert.match(result,/Style: Default,DLY1TJDA,50,&H00FFFFFF,&H00D22FAB,2/);
 assert.match(result,/\\fnDLY1TJDA\\fs42\\pos\(100,200\)/);
 assert.equal(result.replaceAll('DLY1TJDA','DR7UOBXG'),ass,'only font references may change');
});
test('preserves a working subset alias even when another subset of the family exists',()=>{
 assert.equal(resolveAssSubsetFonts(ass,[{name:'方正准圆_GBK.DR7UOBXG.ttf'},{name:'方正准圆_GBK.DLY1TJDA.ttf'}]),ass);
});
test('does not guess when fonts are missing or the original family is ambiguous',()=>{
 assert.equal(resolveAssSubsetFonts(ass,[]),ass);
 assert.equal(resolveAssSubsetFonts(ass,[{name:'Other.DLY1TJDA.ttf'}]),ass);
 assert.equal(resolveAssSubsetFonts(ass,[{name:'方正准圆_GBK.DLY1TJDA.ttf'},{name:'方正准圆_GBK.AAAAAAAA.ttf'}]),ass);
});
test('matches attachment family spelling and handles reordered ASS style columns',()=>{
 const content='; Font Subset: OLDFONT1 - FOT-PopJoy Std B\n[V4+ Styles]\nFormat: Name,Fontsize,Fontname,Outline\nStyle: OP,48,OLDFONT1,2\n';
 assert.equal(resolveAssSubsetFonts(content,[{name:'FOT-PopJoyStd-B.EAAA31RG.otf'}]),content.replace('48,OLDFONT1','48,EAAA31RG'));
});
