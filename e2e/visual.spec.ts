import { test, expect } from "@playwright/test";

/**
 * 视觉回归基线（docs/06 §8.3）：确定性 fixture 数据（seed-fixture），
 * 动画禁用 + 网络空闲后截图；首次用 --update-snapshots 生成基线。
 * 仅 desktop 视口（视觉基线不追求全视口矩阵，保持低成本）。
 */

test.describe("visual regression（fixture-book）", () => {
  const ROUTES: Array<{ name: string; path: string; settleMs?: number }> = [
    { name: "ui", path: "/ui" },
    { name: "book", path: "/books/fixture-book" },
    { name: "bible", path: "/books/fixture-book/bible" },
    { name: "script", path: "/books/fixture-book/script" },
    { name: "assets", path: "/books/fixture-book/assets" },
    { name: "storyboard", path: "/books/fixture-book/storyboard" },
    { name: "voice", path: "/books/fixture-book/voice" },
    { name: "workbench", path: "/books/fixture-book/workbench", settleMs: 800 },
    { name: "canvas", path: "/books/fixture-book/canvas", settleMs: 1200 },
  ];

  for (const route of ROUTES) {
    test(`${route.name}`, async ({ page }) => {
      await page.goto(route.path);
      await page.waitForLoadState("networkidle");
      // 客户端 fetch 数据渲染 + ReactFlow fitView 稳定
      await page.waitForTimeout(route.settleMs ?? 400);
      await expect(page).toHaveScreenshot(`${route.name}.png`, {
        animations: "disabled",
        maxDiffPixelRatio: 0.02,
      });
    });
  }
});
