#!/usr/bin/env node
/**
 * nc-ui-contract 配套机器检查（docs/06-ui-optimization-plan.md §7.3）。
 * 规则必须可被机器检查，否则等于没有。非零退出 = 有违规。
 *
 * 覆盖：硬编码十六进制色 / 任意值动效时长 / 旧主按钮与错误横幅残留 /
 *       本地枚举重复定义 / loading 文案三元。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src/app", "src/components"];

const RULES = [
  {
    name: "硬编码十六进制颜色",
    re: /className="[^"]*#[0-9a-fA-F]{3,8}\b[^"]*"/,
    hint: "改用 @theme 令牌（bg-surface / text-text-muted / border-approved 等）",
  },
  {
    name: "任意值颜色 bg-[#",
    re: /bg-\[#/,
    hint: "颜色一律走令牌，禁止任意值",
  },
  {
    name: "任意值动效时长 duration-[",
    re: /duration-\[/,
    hint: "动效时长只用 --dur-instant|fast|base|slow（duration-instant/fast/base/slow）",
  },
  {
    name: "旧主按钮样式残留",
    re: /bg-zinc-900 px-4 py-2 text-sm font-medium text-white/,
    hint: "改用 <Button>（@/components/ui/button）",
  },
  {
    name: "旧错误横幅残留",
    re: /border-red-200 bg-red-50/,
    hint: "改用 <ErrorBanner>（@/components/ui/error-banner）",
  },
  {
    name: "本地枚举重复定义",
    re: /const (EMOTIONS|CAMERAS|TRANSITIONS|ENTER_EXIT)\s*=\s*\[/,
    hint: "从 @/lib/ui/enums 导入",
  },
  {
    name: "loading 文案三元",
    re: /\?\s*"[^"]*…"/,
    hint: "loading 时保留固定文案 + <Button loading>，禁止「…中」文案",
  },
];

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

let violations = 0;
for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  if (!statSync(abs, { throwIfNoEntry: false })) continue;
  for (const file of collectFiles(abs)) {
    const src = readFileSync(file, "utf8");
    for (const rule of RULES) {
      const m = src.match(rule.re);
      if (m) {
        violations++;
        const line = src.slice(0, m.index).split("\n").length;
        console.error(`✗ ${relative(ROOT, file)}:${line}  [${rule.name}] ${rule.hint}`);
      }
    }
  }
}

if (violations > 0) {
  console.error(`\nlint:ui 失败：${violations} 处违规`);
  process.exit(1);
}
console.log("lint:ui 通过：无 UI 契约违规");
