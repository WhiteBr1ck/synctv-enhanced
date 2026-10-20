export const CHAT_HISTORY_LIMIT = 500;

export interface ChatEntry {
  id: string;
  timestamp: number;
  content: string;
  userId?: string;
  username?: string;
}

export interface StoredChatMessage {
  id: number;
  timestamp: number;
  content: string;
  userId: string;
  username: string;
}

const signature = (entry: Pick<ChatEntry, 'timestamp' | 'userId' | 'content'>) =>
  JSON.stringify([entry.userId, entry.timestamp, entry.content]);

// The WebSocket is already open while history is fetched. Remove overlapping
// messages by occurrence count so identical messages in the same ms survive.
export function mergeChatHistory(history: StoredChatMessage[], current: ChatEntry[]): ChatEntry[] {
  const counts = new Map<string, number>();
  const restored: ChatEntry[] = history.map(message => {
    const key = signature(message);
    counts.set(key, (counts.get(key) || 0) + 1);
    return { ...message, id: `history:${message.id}` };
  });
  for (const entry of current) {
    if (entry.id.startsWith('history:')) continue;
    const key = signature(entry);
    const count = counts.get(key) || 0;
    if (count > 0) counts.set(key, count - 1);
    else restored.push(entry);
  }
  return restored.sort((left, right) => left.timestamp - right.timestamp).slice(-CHAT_HISTORY_LIMIT);
}

// The old server escapes text before broadcasting. Decode once, then let Vue
// render it as text instead of treating chat history as HTML.
export function chatText(entry: Pick<ChatEntry, 'content' | 'username'>): string {
  const content = entry.content.replace(/&(lt|gt|amp|#34|#39);/g, value =>
    ({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&#34;': '"', '&#39;': "'" })[value] || value);
  return entry.username === undefined ? content : `${entry.username}: ${content}`;
}
