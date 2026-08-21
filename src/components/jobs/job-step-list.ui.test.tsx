import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobStepList } from "./job-step-list";
import type { UseJobState } from "@/lib/ui/use-job";

function makeState(partial: Partial<UseJobState>): UseJobState {
  return {
    jobId: "j1",
    status: "idle",
    progress: 0,
    step: null,
    stepIndex: 0,
    stepTotal: 0,
    logs: [],
    error: null,
    elapsedMs: 0,
    lastEventAt: null,
    ...partial,
  };
}

describe("JobStepList（docs/06 §6.2）", () => {
  it("running：显示当前步骤 + 真实分母 + 进度条 + 取消按钮", () => {
    render(
      <JobStepList
        state={makeState({ status: "running", step: "合成第 3/8 句", stepIndex: 3, stepTotal: 8, progress: 0.375, elapsedMs: 45000 })}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByText(/合成第 3\/8 句/)).toBeTruthy();
    expect(screen.getByText(/^3\/8 · 45s$/)).toBeTruthy();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "38");
    expect(screen.getByRole("button", { name: "取消任务" })).toBeTruthy();
  });

  it("无真实进度时绝不显示假百分比", () => {
    render(<JobStepList state={makeState({ status: "running", step: "AI 改编中", stepIndex: 0, stepTotal: 0, progress: 0 })} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText(/AI 改编中/)).toBeTruthy();
  });

  it("终态：succeeded / failed / cancelled", () => {
    const { rerender } = render(<JobStepList state={makeState({ status: "succeeded" })} />);
    expect(screen.getByText("✓ 已完成")).toBeTruthy();

    rerender(<JobStepList state={makeState({ status: "failed", error: "LLM 超时" })} />);
    expect(screen.getByRole("alert").textContent).toContain("LLM 超时");

    rerender(<JobStepList state={makeState({ status: "cancelled", step: "合成第 5/8 句" })} />);
    expect(screen.getByText(/已取消/).textContent).toContain("合成第 5/8 句");
  });

  it("idle / 无 jobId 不渲染", () => {
    const { container } = render(<JobStepList state={makeState({ jobId: null, status: "idle" })} />);
    expect(container.innerHTML).toBe("");
  });
});
