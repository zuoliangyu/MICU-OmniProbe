import { expect, test, type Page } from "@playwright/test";

interface RttTestWindow extends Window {
  emitTestEvent: (event: string, payload: unknown) => void;
  rttStartCalls: Record<string, unknown>[];
  rttWrites: Record<string, unknown>[];
  /** 下一次 start_rtt 等待多久才返回，用于观察“查找控制块”状态 */
  rttStartDelay: number;
  rttStartError: string | null;
}

const config = {
  up_channels: [
    { index: 0, name: "Terminal", buffer_size: 1024 },
    { index: 1, name: "Scope", buffer_size: 512 },
  ],
  down_channels: [{ index: 0, name: "Terminal", buffer_size: 16 }],
  control_block_address: 0x20000400,
  located_by: "自动扫描 RAM",
  session_source: "rtt",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((rttConfig) => {
    const target = window as unknown as RttTestWindow;
    localStorage.setItem("app_mode", "rtt");
    let callbackId = 0;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<string, Set<number>>();
    target.rttStartCalls = [];
    target.rttWrites = [];
    target.rttStartDelay = 0;
    target.rttStartError = null;
    target.emitTestEvent = (event, payload) => {
      for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, id, payload });
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
        if (command === "get_rtt_connection_status") return { connected: true, info: null };
        if (command === "get_connection_status") return { connected: false, info: null };
        if (command === "start_rtt") {
          target.rttStartCalls.push(payload.options);
          const delay = target.rttStartDelay;
          target.rttStartDelay = 0;
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          if (target.rttStartError) throw target.rttStartError;
          return rttConfig;
        }
        if (command === "write_rtt") {
          target.rttWrites.push(payload.options);
          return 1;
        }
        if (command === "list_probes" || command === "list_imported_packs" || command === "search_chips") return [];
        if (command === "init_packs") return 0;
        if (command === "plugin:window|is_maximized") return false;
        return null;
      },
    };
    Object.assign(window, {
      __TAURI_INTERNALS__: internals,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => callbacks.delete(id) },
    });
  }, config);
});

function emit(page: Page, event: string, payload: unknown) {
  return page.evaluate(([name, value]) => (window as unknown as RttTestWindow).emitTestEvent(name, value), [
    event,
    payload,
  ] as const);
}

function dataBatch(chunks: { channel: number; text: string }[]) {
  return {
    timestamp: Date.now(),
    chunks: chunks.map(({ channel, text }) => ({ channel, data: Buffer.from(text).toString("base64") })),
  };
}

async function expectNoOverflow(page: Page, selector: string) {
  const overflow = await page.locator(selector).evaluateAll((els) =>
    els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent?.slice(0, 40))
  );
  expect(overflow).toEqual([]);
}

test("RTT 启动设置、查找状态、恢复提示、暂停缓存与下行发送", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");

  // 启动设置：范围模式要把起始地址和大小都传给后端
  const scanButton = page.getByRole("button", { name: "自动扫描 RAM" });
  await expect(scanButton).toBeVisible();
  await scanButton.click();
  await page.getByRole("combobox", { name: "扫描模式" }).click();
  await page.getByRole("option", { name: "地址范围" }).click();
  const start = page.getByLabel("起始地址");
  await start.fill("0x2000_8000");
  await start.press("Enter");
  const size = page.getByLabel("范围大小 (字节)");
  await size.fill("zz");
  await expect(size).toHaveAttribute("aria-invalid", "true");
  await size.fill("4000");
  await size.press("Enter");
  await expect(size).toHaveValue("0x00004000");
  await page.screenshot({ path: "test-results/rtt-start-settings.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "地址范围" })).toBeVisible();

  // 查找控制块期间：显示状态，按钮变为取消，不能重复启动
  await page.evaluate(() => ((window as unknown as RttTestWindow).rttStartDelay = 800));
  await page.getByRole("button", { name: "启动", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消启动" })).toBeVisible();
  await expect(page.getByText("查找控制块...")).toBeVisible();
  await page.screenshot({ path: "test-results/rtt-starting.png" });
  await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible({ timeout: 3000 });
  const calls = await page.evaluate(() => (window as unknown as RttTestWindow).rttStartCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ scan_mode: "range", range_start: 0x20008000, range_size: 0x4000 });
  await expect(page.getByText("控制块 0x20000400")).toBeVisible();

  // 后端的“已运行”状态事件和批量数据
  await emit(page, "rtt-status", { running: true, error: null, phase: "attached", config: null });
  await emit(
    page,
    "rtt-data",
    dataBatch([
      { channel: 0, text: "boot ok\n" },
      { channel: 1, text: "1,2,3\n" },
    ])
  );
  await expect(page.getByText("boot ok")).toBeVisible();
  await expect(page.getByText("1,2,3")).toBeVisible();

  // 目标复位：恢复提示与状态，恢复后提示消失
  await emit(page, "rtt-status", { running: true, error: null, phase: "recovering", config: null });
  await expect(page.getByRole("status").filter({ hasText: "重新查找 RTT 控制块" })).toBeVisible();
  await expect(page.getByText("重新附加中")).toBeVisible();
  await expect(page.getByLabel("RTT 发送内容")).toBeDisabled();
  await page.screenshot({ path: "test-results/rtt-recovering.png" });
  await emit(page, "rtt-status", {
    running: true,
    error: null,
    phase: "attached",
    config: { ...config, control_block_address: 0x20001000, located_by: "重新扫描 (0x20001000)" },
  });
  await expect(page.getByRole("status").filter({ hasText: "重新查找 RTT 控制块" })).toHaveCount(0);
  await expect(page.getByText("控制块 0x20001000")).toBeVisible();

  // 暂停显示：数据继续缓存，继续后补上
  await page.getByRole("button", { name: "暂停显示" }).click();
  await emit(page, "rtt-data", dataBatch([{ channel: 0, text: "while paused 1\nwhile paused 2\n" }]));
  await expect(page.getByRole("button", { name: "继续 (+2)" })).toBeVisible();
  await expect(page.getByText("while paused 1")).toHaveCount(0);
  await page.getByRole("button", { name: "继续 (+2)" }).click();
  await expect(page.getByText("while paused 2")).toBeVisible();

  // 下行发送：文本、历史、HEX 校验
  const input = page.getByLabel("RTT 发送内容");
  await input.fill("led on");
  await input.press("Enter");
  await expect(page.getByText("[→0]")).toBeVisible();
  await expect(input).toHaveValue("");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("led on");
  await input.fill("");
  await page.getByRole("button", { name: "发送选项" }).click();
  await page.getByLabel("HEX 模式").click();
  await page.keyboard.press("Escape");
  await input.fill("4F 4B");
  await input.press("Enter");
  await input.fill("4F 4");
  await input.press("Enter");
  // 非法 HEX 不发送、保留输入，错误写入输出日志（与串口发送栏一致）
  await expect(input).toHaveValue("4F 4");
  await page.getByTitle("展开日志").click();
  await expect(page.getByText("RTT 发送失败: 无效的十六进制格式").first()).toBeVisible();
  const writes = await page.evaluate(() => (window as unknown as RttTestWindow).rttWrites);
  expect(writes).toEqual([
    { channel: 0, text: "led on", encoding: "utf-8", line_ending: "lf" },
    { channel: 0, data: [0x4f, 0x4b] },
  ]);
  await page.screenshot({ path: "test-results/rtt-running-send.png" });

  await expectNoOverflow(page, "button");

  // 后端报错停止：错误显示且暂停状态被清除
  await page.getByRole("button", { name: "暂停显示" }).click();
  await emit(page, "rtt-status", { running: false, error: "目标失联超过 10 秒，RTT 已停止：x", phase: null, config: null });
  await expect(page.getByText("目标失联超过 10 秒")).toBeVisible();
  await expect(page.getByRole("button", { name: "启动", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "暂停显示" })).toBeDisabled();
  await expect(page.getByLabel("RTT 发送内容")).toHaveCount(0);
  await page.screenshot({ path: "test-results/rtt-stopped-error.png" });

  // 页面需要能完整显示，不出现整页滚动
  const pageScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(pageScroll).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("RTT 启动失败时显示可操作的提示，ELF 模式缺文件时不调用后端", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "自动扫描 RAM" }).click();
  await page.getByRole("combobox", { name: "扫描模式" }).click();
  await page.getByRole("option", { name: "ELF 符号" }).click();
  await expect(page.getByText("尚未选择")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "启动", exact: true }).click();
  await expect(page.getByText("ELF 模式需要先选择固件 ELF / AXF 文件").first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as RttTestWindow).rttStartCalls)).toHaveLength(0);

  await page.getByRole("button", { name: "ELF 符号" }).click();
  await page.getByRole("combobox", { name: "扫描模式" }).click();
  await page.getByRole("option", { name: "自动扫描 RAM" }).click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    (window as unknown as RttTestWindow).rttStartError = "RTT错误: 在扫描范围内找到多个 RTT 控制块（0x20000000, 0x20001000）。";
  });
  await page.getByRole("button", { name: "启动", exact: true }).click();
  await expect(page.getByText("RTT 工作流出现错误")).toBeVisible();
  await expect(page.getByText(/^在扫描范围内找到多个 RTT 控制块/)).toBeVisible();
  await expect(page.getByRole("button", { name: "启动", exact: true })).toBeEnabled();
  await page.screenshot({ path: "test-results/rtt-start-error.png" });
});
