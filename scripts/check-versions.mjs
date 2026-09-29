// 校验 AGENTS.md「版本发布清单」要求的 5 处版本号是否一致。
// 默认以 package.json 为基准；传 `--expect <版本>` 或设置 EXPECTED_VERSION 时改以该版本为基准。
// 不一致直接非零退出（版本不一致会导致构建失败）。
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");

const expectIndex = process.argv.indexOf("--expect");
const expectedArg = (expectIndex >= 0 ? process.argv[expectIndex + 1] : process.env.EXPECTED_VERSION)?.trim();

const pkg = JSON.parse(await read("package.json"));
const expected = expectedArg || pkg.version;

const cargoToml = await read("src-tauri/Cargo.toml");
const tauriConf = JSON.parse(await read("src-tauri/tauri.conf.json"));
const readme = await read("README.md");
const changelog = await read("CHANGELOG.md");

const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// README 徽章里 SemVer 的 "-" 会被 shields.io 转义成 "--"
const badgeVersion = expected.replace(/-/g, "--").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const checks = [
  { label: "package.json", actual: pkg.version },
  { label: "src-tauri/Cargo.toml", actual: cargoVersion },
  { label: "src-tauri/tauri.conf.json", actual: tauriConf.version },
  {
    label: "README.md 版本徽章",
    ok: new RegExp(`version-${badgeVersion}-blue`).test(readme),
  },
  {
    label: "README.md 更新重点标题",
    ok: new RegExp(`^## ${escaped} 更新重点`, "m").test(readme),
  },
  {
    label: "README.md 当前版本行",
    ok: new RegExp(`当前版本：\`${escaped}\``).test(readme),
  },
  {
    label: "CHANGELOG.md 版本条目",
    ok: new RegExp(`##\\s*\\[${escaped}\\]`).test(changelog),
  },
];

let failed = 0;
console.log(`基准版本（${expectedArg ? "指定" : "package.json"}）：${expected}\n`);

for (const check of checks) {
  const ok = "ok" in check ? check.ok : check.actual === expected;
  if (!ok) failed += 1;
  const detail = "actual" in check ? ` (实际: ${check.actual ?? "未找到"})` : "";
  console.log(`${ok ? "OK  " : "FAIL"}  ${check.label}${ok ? "" : detail}`);
}

if (failed > 0) {
  console.error(`\n${failed} 处版本号与基准版本 ${expected} 不一致`);
  process.exit(1);
}
console.log(`\n${checks.length} 处版本号一致`);
