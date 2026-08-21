import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { Button } from "./button";
import { ErrorBanner } from "./error-banner";
import { SectionCard } from "./section-card";
import { StatusBadge, StatusPill } from "./status-badge";
import { EmptyState } from "./empty-state";
import { Field } from "./field";
import { Input } from "./input";
import { Select } from "./select";
import { Textarea } from "./textarea";
import { Card } from "./card";
import { ListRow } from "./list-row";
import { PageHeader } from "./page-header";
import { PhaseRail } from "./phase-rail";
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

  it("EmptyState：说明必渲染，标题/动作可选；不带按钮时无多余交互", () => {
    const { rerender } = render(
      <EmptyState title="还没有分镜" description="先跑改编，再点构建分镜。" />,
    );
    expect(screen.getByText("还没有分镜")).toBeTruthy();
    expect(screen.getByText("先跑改编，再点构建分镜。")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();

    rerender(<EmptyState description="还没有项目" action={<Button>上传</Button>} />);
    expect(screen.getByRole("button", { name: "上传" })).toBeTruthy();
  });

  it("Field/Input/Select/Textarea：标签/提示/错误与统一控件状态", () => {
    const { rerender } = render(
      <Field label="书名" htmlFor="book-title" error="必填">
        <Input id="book-title" invalid placeholder="书名" />
      </Field>,
    );
    expect(screen.getByLabelText("书名")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("必填");
    expect(screen.getByLabelText("书名")).toHaveAttribute("aria-invalid", "true");

    rerender(
      <Field label="书名" htmlFor="book-title" hint="支持中文">
        <Input id="book-title" placeholder="书名" />
      </Field>,
    );
    expect(screen.getByText("支持中文")).toBeTruthy();

    render(<Select aria-label="角色" defaultValue="林晚"><option>林晚</option></Select>);
    expect(screen.getByLabelText("角色")).toBeTruthy();

    render(<Textarea aria-label="备注" mono placeholder="JSON" />);
    const ta = screen.getByLabelText("备注");
    expect(ta.className).toContain("font-mono");
  });

  it("Card：标题/动作/选中态；ListRow：leading/trailing", () => {
    render(
      <Card title="全书档案" actions={<Button size="sm">操作</Button>} selected>
        内容区
      </Card>,
    );
    expect(screen.getByText("全书档案")).toBeTruthy();
    expect(screen.getByRole("button", { name: "操作" })).toBeTruthy();

    render(
      <ul>
        <ListRow leading={<span>章节 1</span>} trailing={<span>4,200 字</span>}>
          正文
        </ListRow>
      </ul>,
    );
    expect(screen.getByText("章节 1")).toBeTruthy();
    expect(screen.getByText("4,200 字")).toBeTruthy();
  });

  it("PageHeader/PhaseRail：统一页头与流程铁路", () => {
    render(
      <PageHeader title="改编脚本" meta="签核 B" backHref="/" backLabel="← 返回" actions={<Button>运行</Button>} />,
    );
    expect(screen.getByRole("heading", { name: /改编脚本/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "← 返回" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "运行" })).toBeTruthy();

    const { container } = render(<PhaseRail current={2} />);
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain("改编");
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
