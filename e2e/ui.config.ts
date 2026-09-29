import { defineConfig, devices } from "@playwright/test";

const devServerPort = 3216;

export default defineConfig({
  testDir: ".",
  outputDir: "../test-results/playwright",
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${devServerPort}`,
    browserName: "chromium",
    channel: "msedge",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: `http://127.0.0.1:${devServerPort}`,
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      TAURI_DEV_HOST: "127.0.0.1",
      TAURI_DEV_PORT: String(devServerPort),
      TAURI_DEV_HMR_PORT: String(devServerPort + 1),
    },
  },
  // 桌面端应用：UI 验收只使用 1920×1080（见 AGENTS.md「前端 UI 验证」）
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Edge"], viewport: { width: 1920, height: 1080 } },
    },
  ],
});
