import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * 全页面 axe 审计（docs/08 §8）：critical/serious = 0。
 * 覆盖桌面/移动双视口（移动仅作为回归，不新增移动端样式适配工作）。
 */
const ROUTES = [
  { name: "home", path: "/" },
  { name: "ui", path: "/ui" },
  { name: "book", path: "/books/fixture-book" },
  { name: "bible", path: "/books/fixture-book/bible" },
  { name: "script", path: "/books/fixture-book/script" },
  { name: "assets", path: "/books/fixture-book/assets" },
  { name: "storyboard", path: "/books/fixture-book/storyboard" },
  { name: "voice", path: "/books/fixture-book/voice" },
  { name: "render", path: "/books/fixture-book/render" },
  { name: "workbench", path: "/books/fixture-book/workbench" },
  { name: "canvas", path: "/books/fixture-book/canvas" },
];

for (const route of ROUTES) {
  test(`axe ${route.name}`, async ({ page }) => {
    await page.goto(route.path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(route.name === "canvas" ? 1200 : 400);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(
      serious.map((v) => `${v.id}: ${v.help}`),
      JSON.stringify(serious, null, 2),
    ).toEqual([]);
  });
}
