// src/lib/serialHistory.ts
// 发送历史的共享存储 (串口 SendBar 与 Terminal 行编辑模式都读/写它；RTT 下行发送用独立的键)

const SEND_HISTORY_KEY = "serial_send_history";
export const RTT_SEND_HISTORY_KEY = "rtt_send_history";
export const MAX_SEND_HISTORY = 20;

export function loadSendHistory(key = SEND_HISTORY_KEY): string[] {
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

export function saveSendHistory(history: string[], key = SEND_HISTORY_KEY): void {
  try {
    localStorage.setItem(key, JSON.stringify(history.slice(0, MAX_SEND_HISTORY)));
  } catch {
    // silent fail
  }
}

/** 把一条新发送插入历史首位，去重，返回截断后的新历史。 */
export function pushSendHistory(history: string[], text: string, key = SEND_HISTORY_KEY): string[] {
  if (!text) return history;
  const next = [text, ...history.filter((h) => h !== text)].slice(0, MAX_SEND_HISTORY);
  saveSendHistory(next, key);
  return next;
}
