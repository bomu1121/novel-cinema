import { test, expect } from "@playwright/test";

/**
 * 键盘走查（docs/08 §8）：每个页面至少能 Tab 移动焦点、Esc/Enter 基础可交互。
 * 仅桌面端运行（用户明确不做手机端适配）。
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
  test(`keyboard ${route.name}`, async ({ page, isMobile }) => {
    test.skip(isMobile, "手机端不做键盘走查");
    await page.goto(route.path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(route.name === "canvas" ? 1200 : 400);
    await page.locator("body").focus();
    let moved = false;
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press("Tab");
      const active = await page.evaluate(() => {
        const el = document.activeElement;
        return el && el !== document.body ? el.tagName : "";
      });
      if (active) {
        moved = true;
        break;
      }
    }
    expect(moved, `${route.path} 应能通过 Tab 移动焦点`).toBe(true);
  });
}
