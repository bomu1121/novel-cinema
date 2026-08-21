import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { Button } from "./button";
import { ErrorBanner } from "./error-banner";
import { SectionCard } from "./section-card";
import { StatusBadge, StatusPill } from "./status-badge";
import { ToastProvider } from "../toast";

function renderWithAxe(ui: React.ReactElement) {
  const { container } = render(ui);
  return { container };
}

describe("UI kit（docs/06 §6.1）", () => {
  it("Button：默认主样式、命中区 ≥24px、loading 时 aria-busy 且保留原文案", () => {
    const { rerender } = render(<Button loading>保存</Button>);
    const btn = screen.getByRole("button", { name: "保存" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn.className).toMatch(/min-h-9/);
    expect(screen.getByText("保存")).toBeTruthy();

    rerender(<Button size="sm">小按钮</Button>);
    expect(screen.getByRole("button", { name: "小按钮" }).className).toMatch(/min-h-6/);
  });

  it("ErrorBanner：空消息不渲染；有消息时 role=alert", () => {
    const { container, rerender } = render(<ErrorBanner message={null} />);
    expect(container.innerHTML).toBe("");
    rerender(<ErrorBanner message="分析失败" />);
    expect(screen.getByRole("alert").textContent).toContain("分析失败");
  });

  it("StatusBadge：中文标签 + 语义色；stale 显示影响数", () => {
    render(<StatusBadge status="stale" impactCount={6} />);
    expect(screen.getByText("已过期")).toBeTruthy();
    const impact = screen.getByRole("button", { name: "影响 6" });
    expect(impact).toBeTruthy();
  });

  it("StatusPill：审阅态→徽章；执行态→进度 chip；未知→不渲染", () => {
    const { container, rerender } = render(<StatusPill table="beats" status="pending_review" />);
    expect(screen.getByText("待审")).toBeTruthy();

    rerender(<StatusPill table="assets" status="generating" />);
    expect(screen.getByText("生成中")).toBeTruthy();

    rerender(<StatusPill table="clues" status="red_herring" />);
    expect(screen.getByText("红鲱鱼")).toBeTruthy();

    rerender(<StatusPill table="beats" status="no-such-value" />);
    expect(container.innerHTML).toBe("");
  });

  it("SectionCard：标题与内容渲染", () => {
    render(<SectionCard title="全书档案">内容区</SectionCard>);
    expect(screen.getByText("全书档案")).toBeTruthy();
    expect(screen.getByText("内容区")).toBeTruthy();
  });

  it("可达性：kit 组合渲染无 axe critical/serious 违规", async () => {
    const { container } = renderWithAxe(
      <ToastProvider>
        <div>
          <Button>运行分析</Button>
          <StatusBadge status="review" />
          <ErrorBanner message="出错" />
        </div>
      </ToastProvider>,
    );
    const results = await axe.run(container, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] });
    const serious = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
