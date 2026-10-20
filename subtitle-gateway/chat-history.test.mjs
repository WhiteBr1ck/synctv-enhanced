import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeChatHistory, chatText } from '../synctv-web/src/utils/chat-history.ts';

test('history restore merges concurrent live messages without duplicating them', () => {
  const stored=[{id:1,timestamp:100,userId:'u',username:'user',content:'hello'}];
  const current=[{...stored[0],id:'live:1'},{id:'live:2',timestamp:101,userId:'u',username:'user',content:'new'}];
  assert.deepEqual(mergeChatHistory(stored,current).map(message=>message.content),['hello','new']);
});

test('identical chat messages sent in the same millisecond are preserved', () => {
  const entry={timestamp:100,userId:'u',username:'user',content:'same'};
  const merged=mergeChatHistory([{...entry,id:1},{...entry,id:2}],[{...entry,id:'live:1'},{...entry,id:'live:2'}]);
  assert.deepEqual(merged.map(message=>message.id),['history:1','history:2']);
});

test('reconnect uses authoritative retained history and drops expired rows', () => {
  const result=mergeChatHistory([{id:2,timestamp:200,userId:'u',username:'user',content:'retained'}],[
    {id:'history:1',timestamp:100,userId:'u',username:'user',content:'expired'},
    {id:'history:2',timestamp:200,userId:'u',username:'user',content:'retained'}]);
  assert.equal(result.length,1);
  assert.equal(result[0].id,'history:2');
});

test('chat renders escaped content and untrusted usernames as plain text', () => {
  assert.equal(chatText({username:'<img>',content:'&lt;script&gt; &amp;lt; &#34; &#39;'}),'<img>: <script> &lt; " \'');
});
