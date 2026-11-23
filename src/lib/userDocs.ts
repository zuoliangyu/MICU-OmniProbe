import { open as openExternal } from "@tauri-apps/plugin-shell";
import type { AppMode } from "@/lib/workspaces";

export const USER_DOCS_URL = "https://zuoliangyu.github.io/MICU-OmniProbe/";

/** 在线文档（docsify）中某一页的地址，page 为 docs/ 下的文件名（不含 .md）。 */
export function userDocUrl(page: string) {
  return `${USER_DOCS_URL}#/${page}`;
}

/** 每个工作台对应的使用教程页。 */
const WORKSPACE_DOC_PAGES: Record<AppMode, string> = {
  flash: "FLASH_USER_MANUAL",
  rtt: "RTT_USER_MANUAL",
  serial: "SERIAL_TERMINAL_GUIDE",
  "log-analysis": "LOG_ANALYSIS_GUIDE",
  bluetooth: "BLUETOOTH_USER_MANUAL",
  "control-panel": "SERIAL_CONTROL_PANEL_GUIDE",
  debug: "DEBUG_USER_MANUAL",
};

export function workspaceDocUrl(mode: AppMode) {
  return userDocUrl(WORKSPACE_DOC_PAGES[mode]);
}

export function openUserDocs(url: string = USER_DOCS_URL) {
  void openExternal(url).catch((error) => console.error("打开在线文档失败:", error));
}
