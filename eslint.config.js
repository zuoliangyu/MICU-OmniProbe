import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// 本项目未启用 React Compiler。关闭只影响 Compiler 优化、且会误报现有遥测热路径的规则；
// purity / immutability 仍保留，rules-of-hooks 继续作为硬错误。
const REACT_COMPILER_RULES = {
  "react-hooks/refs": "off",
  "react-hooks/purity": "warn",
  "react-hooks/immutability": "warn",
  "react-hooks/set-state-in-effect": "off",
  "react-hooks/preserve-manual-memoization": "off",
  "react-hooks/incompatible-library": "off",
  "react-hooks/rules-of-hooks": "error",
};

const FAST_REFRESH_TEST_EXPORTS = [
  "resolveChartDisplayData",
  "traceSignalPath",
  "buildSerialControlChartData",
  "isSerialDisplayWidget",
  "isSerialSendWidget",
  "isSerialVisualizationWidget",
];

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/**",
      "public/**",
      "docs/**",
      "examples/**",
      "RTTBSP/**",
      "skills/**",
    ],
  },

  // 前端源码
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...REACT_COMPILER_RULES,
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true, allowExportNames: FAST_REFRESH_TEST_EXPORTS },
      ],

      // tsconfig 已开 noUnusedLocals / noUnusedParameters，交给 tsc 报，避免重复
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",

      // Tauri 事件载荷有大量 any，先 warn 便于逐步收敛
      "@typescript-eslint/no-explicit-any": "warn",

      // ANSI 转义解析必须匹配 \x1b，这是功能本身而不是笔误
      "no-control-regex": "off",

      // shadcn/ui 的惯用写法：空 interface 继承原生 props 以保留命名
      "@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "with-single-extends" }],

      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Node 侧脚本与构建配置（.mts 需要 TS parser）
  {
    files: ["scripts/**/*.{mjs,mts,js}", "*.config.{js,ts}", "vite.config.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      // 检查脚本里用 _ 前缀标记「解构出来但有意不用」的变量
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  }
);
