import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { StagedReviewPanel } from "./staged-review-panel";

const ENTRIES = Array.from({ length: 6 }, (_, i) => ({
  id: `e${i}`,
  bookId: "b1",
  jobId: "j1",
  node: "adapt",
  groupKey: `beat#${i + 1}`,
  seq: i + 1,
  tableName: "beats",
  op: i % 2 === 0 ? ("update" as const) : ("insert" as const),
  rowId: i % 2 === 0 ? `old${i}` : null,
  before: i % 2 === 0 ? { id: `old${i}`, text: `旧台词${i}`, emotion: "neutral" } : null,
  after: { id: `new${i}`, text: `新台词${i}`, emotion: "happy" },
  status: "pending",
}));

function mockFetch(entries = ENTRIES) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/staged")) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { decisions: Record<string, string> };
        return {
          ok: true,
          json: async () => ({
            ok: true,
            applied: Object.values(body.decisions).filter((d) => d === "accepted").length,
            rejected: Object.values(body.decisions).filter((d) => d === "rejected").length,
          }),
        };
      }
      return { ok: true, json: async () => ({ groups: [], entries }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function press(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  // 让 React flush 与 effect 重注册（真实场景按键间隔远超此值）
  await new Promise((r) => setTimeout(r, 20));
}

describe("StagedReviewPanel（docs/06 §6.3 DiffReview）", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("每屏 ≤4 组（Cowan ~4 chunk），超出显示页码", async () => {
    mockFetch();
    render(<StagedReviewPanel bookId="b1" jobId="j1" />);
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0));
    const groups = screen.getAllByRole("listitem");
    expect(groups.length).toBe(4);
    expect(screen.getByText(/第 1\/2 页/)).toBeTruthy();
  });

  it("纯键盘：j 移动 + a 接受 + r 驳回 + 应用已选只提交已决策项", async () => {
    const fetchMock = mockFetch();
    render(<StagedReviewPanel bookId="b1" jobId="j1" />);
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(4));

    // 光标在 e0：a 接受
    await press("a");
    // j 移到 e1：r 驳回
    await press("j");
    await press("r");
    // j 移到 e2：a 接受
    await press("j");
    await press("a");

    await waitFor(() => expect(screen.getByText(/已决策 3（接受 2 \/ 驳回 1）/)).toBeTruthy());

    // Enter 应用
    await press("Enter");
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(post).toBeTruthy();
      const decisions = JSON.parse(String(post![1]!.body)) as { decisions: Record<string, string> };
      expect(Object.keys(decisions.decisions)).toHaveLength(3);
      expect(decisions.decisions.e0).toBe("accepted");
      expect(decisions.decisions.e1).toBe("rejected");
    });
  });

  it("u 撤销上一条决策", async () => {
    mockFetch();
    render(<StagedReviewPanel bookId="b1" jobId="j1" />);
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(4));
    await press("a");
    await press("j");
    await press("a");
    await waitFor(() => expect(screen.getByText(/已决策 2/)).toBeTruthy());
    await press("u");
    await waitFor(() => expect(screen.getByText(/已决策 1/)).toBeTruthy());
  });

  it("全部接受需二次确认（不是默认焦点路径）", async () => {
    const fetchMock = mockFetch();
    render(<StagedReviewPanel bookId="b1" jobId="j1" />);
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(4));

    const allBtn = screen.getByRole("button", { name: "全部接受" });
    fireEvent.click(allBtn);
    // 需要再点"确认"才提交全部
    const confirmBtn = screen.getByRole("button", { name: "确认" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      const decisions = JSON.parse(String(post![1]!.body)) as { decisions: Record<string, string> };
      expect(Object.keys(decisions.decisions)).toHaveLength(6);
    });
  });
});
