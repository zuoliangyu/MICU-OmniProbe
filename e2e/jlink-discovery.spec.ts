import { expect, test, type Page } from "@playwright/test";
import type { ProbeInfo } from "../src/lib/types";

interface ProbeTestWindow extends Window {
  setTestProbes: (probes: ProbeInfo[]) => void;
  failTestConnection: string | null;
  lastTestConnection: { probe_identifier: string } | null;
  delayTestEnumeration: number;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as ProbeTestWindow;
    localStorage.setItem("app_mode", "flash");
    let probes: ProbeInfo[] = [];
    let connected = false;
    let callbackId = 0;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<string, Set<number>>();
    target.failTestConnection = null;
    target.lastTestConnection = null;
    target.delayTestEnumeration = 0;
    target.setTestProbes = (next) => {
      probes = next;
      for (const id of listeners.get("usb-device-changed") ?? []) {
        callbacks.get(id)?.({ event: "usb-device-changed", id, payload: null });
      }
    };
    const info = {
      probe_name: "J-Link",
      probe_serial: "456",
      target_name: "STM32F103C8",
      core_type: "Armv7m",
      chip_id: null,
      target_idcode: null,
    };
    const internals = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: (callback: (event: unknown) => void) => {
        callbacks.set(++callbackId, callback);
        return callbackId;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      invoke: async (command: string, payload: Record<string, any> = {}) => {
        if (command === "plugin:event|listen") {
          const ids = listeners.get(payload.event) ?? new Set<number>();
          ids.add(payload.handler);
          listeners.set(payload.event, ids);
          return payload.handler;
        }
        if (command === "plugin:event|unlisten") return listeners.get(payload.event)?.delete(payload.eventId);
        if (command === "list_probes") {
          const snapshot = structuredClone(probes);
          const delay = target.delayTestEnumeration;
          target.delayTestEnumeration = 0;
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          return snapshot;
        }
        if (command === "search_chips") return ["STM32F103C8"];
        if (command === "get_chip_info")
          return { name: "STM32F103C8", cores: [], memory_regions: [], flash_algorithms: [] };
        if (command === "connect_target") {
          target.lastTestConnection = payload.options;
          if (target.failTestConnection) throw target.failTestConnection;
          connected = true;
          return { name: "STM32F103C8", core_type: "Armv7m", memory_regions: [], flash_algorithms: [], chip_id: null };
        }
        if (command === "disconnect") connected = false;
        if (command === "get_connection_status") return { connected, info: connected ? info : null };
        if (command === "list_imported_packs") return [];
        if (command === "init_packs") return 0;
        if (command === "plugin:window|is_maximized") return false;
        return null;
      },
    };
    Object.assign(window, {
      __TAURI_INTERNALS__: internals,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => callbacks.delete(id) },
    });
  });
});

function jlink(serial: number, hint: string | null = null): ProbeInfo {
  return {
    probe_id: `jlink:${serial}`,
    identifier: `J-Link (${serial})`,
    vendor_id: 0x1366,
    product_id: 0x0101,
    serial_number: String(serial),
    probe_type: "JLink",
    dap_version: null,
    debug_info: null,
    connection_hint: hint,
  };
}

async function setProbes(page: Page, probes: ProbeInfo[]) {
  await page.evaluate((value) => (window as unknown as ProbeTestWindow).setTestProbes(value), probes);
}

test("J-Link 插拔自动更新、提示缺少运行库并按序列号连接", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const selection = page.getByRole("combobox", { name: "调试探针", exact: true });
  await expect(selection).toHaveText("选择探针");

  const hint =
    "已识别 J-Link，但未找到 SEGGER 运行库。请安装官方 J-Link Software and Documentation Pack 后刷新，无需切换 USB 驱动。";
  await setProbes(page, [jlink(123, hint)]);
  await expect(selection).toContainText("J-Link (123)");
  await expect(page.getByRole("status")).toHaveText(hint);
  const status = page.getByRole("status");
  expect(await status.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: "test-results/jlink-missing-runtime.png" });

  await setProbes(page, [jlink(123), jlink(456)]);
  await expect(page.getByRole("status")).toHaveCount(0);
  await selection.click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.getByRole("option", { name: "J-Link (456)", exact: true }).click();
  await setProbes(page, [jlink(456)]);
  await expect(selection).toContainText("J-Link (456)");

  await page.getByPlaceholder("搜索芯片型号...").fill("STM32F103");
  await page.getByRole("button", { name: "STM32F103C8", exact: true }).click();
  await page.evaluate(() => {
    (window as unknown as ProbeTestWindow).failTestConnection = "J-Link 正由另一个工作台使用，请先断开该工作台的连接。";
  });
  const connect = page.getByRole("button", { name: "连接设备", exact: true });
  await connect.scrollIntoViewIfNeeded();
  await connect.click();
  await expect(page.getByRole("alert")).toContainText("另一个工作台");
  expect(await page.evaluate(() => (window as unknown as ProbeTestWindow).lastTestConnection?.probe_identifier)).toBe(
    "jlink:456"
  );
  await page.getByRole("alert").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/jlink-occupied.png" });

  await page.evaluate(() => {
    (window as unknown as ProbeTestWindow).failTestConnection = null;
  });
  await connect.scrollIntoViewIfNeeded();
  await connect.click();
  await expect(page.getByRole("button", { name: "断开连接", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "断开连接", exact: true }).click();
  await setProbes(page, []);
  await selection.scrollIntoViewIfNeeded();
  await expect(selection).toHaveText("选择探针");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/jlink-unplugged.png" });
  expect(errors).toEqual([]);
});

test("较慢的旧枚举响应不会覆盖新插入的探针", async ({ page }) => {
  await page.goto("/");
  const selection = page.getByRole("combobox", { name: "调试探针", exact: true });
  await expect(selection).toHaveText("选择探针");
  await page.evaluate(() => {
    (window as unknown as ProbeTestWindow).delayTestEnumeration = 1200;
  });
  await setProbes(page, [jlink(123)]);
  await expect(page.getByRole("button", { name: "刷新探针列表" })).toBeDisabled();
  await setProbes(page, [jlink(456)]);
  await expect(selection).toContainText("J-Link (456)");
  // 等待旧响应完成后仍保持最新结果。
  await page.waitForTimeout(1300);
  await expect(selection).toContainText("J-Link (456)");
});
