import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * e2e 基线（docs/06 §8.3 Tier 2）：
 * 1. 首页渲染 + 整页 axe critical/serious = 0
 * 2. prefers-reduced-motion 下所有元素计算样式无 infinite 动画
 */

test("首页渲染并可上传（标题 + 上传按钮）", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "小说影像化工作台" })).toBeVisible();
  await expect(page.getByRole("button", { name: /上传并解析/ })).toBeVisible();
});

test("首页整页 axe 无 critical/serious 违规", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test("prefers-reduced-motion 下无 infinite 动画（计算样式）", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const infinite = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
      const cs = getComputedStyle(el);
      if (cs.animationName && cs.animationName !== "none" && cs.animationIterationCount === "infinite") {
        bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
      }
    }
    return bad;
  });
  // reduced-motion 全局兜底应把动画压成 1 次；kb-* 内容动画被显式禁用
  expect(infinite).toEqual([]);
});
