import { getSupabaseAdmin } from "@/lib/db";
import { estimateNode, type GraphNode } from "@/lib/pipeline/graph";

export type SignOffStatus =
  | "empty"
  | "draft"
  | "review"
  | "approved"
  | "stale"
  | "running"
  | "failed";

export interface SignOffSummary {
  key: string;
  title: string;
  desc: string;
  href: string;
  status: SignOffStatus;
  statusLabel: string;
  /** 未满足的前置条件文案；已就绪时为 null */
  reason: string | null;
  /** 该阶段是否有至少一个可执行/可推进的入口 */
  canRun: boolean;
}

export interface BookReadiness {
  signOffs: SignOffSummary[];
  nodeBlockers: Record<GraphNode, string[]>;
}

const STATUS_LABEL: Record<SignOffStatus, string> = {
  empty: "未开始",
  draft: "草稿",
  review: "待审",
  approved: "已批准",
  stale: "已过期",
  running: "生成中",
  failed: "失败",
};

interface StatusRow {
  status: string | null;
}

/** 把一组审阅/执行状态聚合成“入口可见的单一状态”。 */
function summarizeRows(rows: StatusRow[]): SignOffStatus {
  const statuses = new Set(rows.map((r) => r.status).filter(Boolean) as string[]);
  if (statuses.size === 0) return "empty";
  if (statuses.has("stale")) return "stale";
  if (statuses.has("failed")) return "failed";
  if (statuses.has("approved") || statuses.has("accepted") || statuses.has("succeeded")) return "approved";
  if (statuses.has("pending_review") || statuses.has("candidate") || statuses.has("open")) {
    return "review";
  }
  if (
    statuses.has("running") ||
    statuses.has("generating") ||
    statuses.has("pending") ||
    statuses.has("queued")
  ) {
    return "running";
  }
  return "draft";
}

function blockersFor(nodes: GraphNode[], nodeBlockers: Record<GraphNode, string[]>): string[] {
  return nodes.flatMap((n) => nodeBlockers[n] ?? []);
}

/**
 * 书级就绪摘要：供书首页签核入口展示“有没有内容 / 有没有批准 / 卡在哪一步”。
 * B0（精简底稿）保持可选：它不阻塞 B（改编），只影响改编输入来源。
 */
export async function getBookReadiness(bookId: string): Promise<BookReadiness> {
  const supabase = getSupabaseAdmin();

  const [
    styleRes,
    condensedRes,
    adaptedRes,
    assetRes,
    timelineRes,
    voiceRes,
    renderRes,
  ] = await Promise.all([
    supabase.from("style_bibles").select("status").eq("book_id", bookId),
    supabase.from("condensed_chapters").select("status").eq("book_id", bookId),
    supabase.from("adapted_chapters").select("status").eq("book_id", bookId),
    supabase.from("assets").select("status").eq("book_id", bookId),
    supabase.from("timelines").select("status").eq("book_id", bookId),
    supabase.from("voice_takes").select("status").eq("book_id", bookId),
    supabase.from("render_jobs").select("status").eq("book_id", bookId),
  ]);

  const nodeBlockers = Object.fromEntries(
    await Promise.all(
      (
        [
          "analyze",
          "condense",
          "adapt",
          "assets-phase1",
          "assets-phase2",
          "storyboard",
          "voice",
          "render",
        ] as GraphNode[]
      ).map(async (node) => {
        const estimate = await estimateNode(bookId, node).catch(() => null);
        return [node, estimate?.blockers ?? []];
      }),
    ),
  ) as Record<GraphNode, string[]>;

  const defs: Array<{
    key: string;
    title: string;
    desc: string;
    href: string;
    nodes: GraphNode[];
    rows: StatusRow[];
  }> = [
    {
      key: "A",
      title: "全书档案",
      desc: "人物 / 线索 / 风格方案",
      href: "/bible",
      nodes: ["analyze", "bible.propose"],
      rows: (styleRes.data ?? []) as StatusRow[],
    },
    {
      key: "B0",
      title: "精简底稿",
      desc: "原文对照 · 视频向精简 · 手动修正",
      href: "/condense",
      nodes: ["condense"],
      rows: (condensedRes.data ?? []) as StatusRow[],
    },
    {
      key: "B",
      title: "改编脚本",
      desc: "beats 逐条审阅",
      href: "/script",
      nodes: ["adapt"],
      rows: (adaptedRes.data ?? []) as StatusRow[],
    },
    {
      key: "C",
      title: "资产库",
      desc: "设定图与表情变体",
      href: "/assets",
      nodes: ["assets-phase1", "assets-phase2"],
      rows: (assetRes.data ?? []) as StatusRow[],
    },
    {
      key: "D",
      title: "分镜时间轴",
      desc: "镜头 / 图层 / 预览",
      href: "/storyboard",
      nodes: ["storyboard"],
      rows: (timelineRes.data ?? []) as StatusRow[],
    },
    {
      key: "E",
      title: "多角色配音",
      desc: "TTS + ASR 校验",
      href: "/voice",
      nodes: ["voice"],
      rows: (voiceRes.data ?? []) as StatusRow[],
    },
    {
      key: "F",
      title: "渲染",
      desc: "本地命令与任务记录",
      href: "/render",
      nodes: ["render"],
      rows: (renderRes.data ?? []) as StatusRow[],
    },
  ];

  const signOffs: SignOffSummary[] = defs.map((def) => {
    const status = summarizeRows(def.rows);
    const blockers = blockersFor(def.nodes, nodeBlockers);
    return {
      key: def.key,
      title: def.title,
      desc: def.desc,
      href: def.href,
      status,
      statusLabel: STATUS_LABEL[status],
      reason: blockers.length > 0 ? blockers.join("；") : null,
      canRun: def.nodes.some((n) => (nodeBlockers[n]?.length ?? 0) === 0),
    };
  });

  return { signOffs, nodeBlockers };
}
