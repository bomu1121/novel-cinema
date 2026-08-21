import { describe, expect, it } from "vitest";
import {
  JOB_PHASE_LABEL,
  toJobPhase,
  toReviewStatus,
  neutralStatusLabel,
  REVIEW_STATUS_LABEL,
  PROJECT_PHASES,
} from "./status";

describe("状态三族映射（docs/06 §5.3）", () => {
  it("族 A 审阅态：各表 status → ReviewStatus", () => {
    expect(toReviewStatus("beats", "draft")).toBe("draft");
    expect(toReviewStatus("beats", "pending_review")).toBe("review");
    expect(toReviewStatus("assets", "candidate")).toBe("review");
    expect(toReviewStatus("review_tasks", "open")).toBe("review");
    expect(toReviewStatus("assets", "approved")).toBe("approved");
    expect(toReviewStatus("voice_takes", "accepted")).toBe("approved");
    expect(toReviewStatus("beats", "rejected")).toBe("rejected");
    expect(toReviewStatus("beats", "stale")).toBe("stale");
    expect(toReviewStatus("assets", "archived")).toBe("regen");
    expect(toReviewStatus("review_tasks", "skipped")).toBe("skipped");
  });

  it("族 A 排他：books 的 draft 是全书阶段，不是审阅态", () => {
    expect(toReviewStatus("books", "draft")).toBeNull();
    expect(toReviewStatus("books", "analyzing")).toBeNull();
  });

  it("族 B 执行态不归审阅徽章", () => {
    expect(toReviewStatus("assets", "generating")).toBeNull();
    expect(toReviewStatus("render_jobs", "queued")).toBeNull();
    expect(toReviewStatus("render_jobs", "running")).toBeNull();
    expect(toReviewStatus("render_jobs", "succeeded")).toBeNull();
    expect(toReviewStatus("render_jobs", "cancelled")).toBeNull();
    expect(toJobPhase("queued")).toBe("pending");
    expect(toJobPhase("running")).toBe("running");
    expect(toJobPhase("generating")).toBe("running");
    expect(toJobPhase("succeeded")).toBe("succeeded");
    expect(toJobPhase("failed")).toBe("failed");
    expect(toJobPhase("cancelled")).toBe("cancelled");
    expect(JOB_PHASE_LABEL.cancelled).toBe("已取消");
  });

  it("族 C 领域语义：剧情态与全书阶段走中性标签", () => {
    expect(toReviewStatus("clues", "introduced")).toBeNull();
    expect(neutralStatusLabel("introduced")).toBe("已出场");
    expect(neutralStatusLabel("red_herring")).toBe("红鲱鱼");
    expect(neutralStatusLabel("rendering")).toBe("渲染中");
    expect(neutralStatusLabel("draft")).toBe("未开始");
    expect(neutralStatusLabel("no-such-value")).toBeNull();
    expect(PROJECT_PHASES).toContain("asset_ready");
  });

  it("所有 ReviewStatus 都有中文标签", () => {
    for (const key of ["draft", "review", "approved", "rejected", "stale", "regen", "skipped"]) {
      expect(REVIEW_STATUS_LABEL[key as keyof typeof REVIEW_STATUS_LABEL]).toBeTruthy();
    }
  });
});
