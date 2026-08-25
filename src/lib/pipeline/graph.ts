import { getSupabaseAdmin } from "@/lib/db";

/**
 * 声明式依赖 DAG（docs/06 §4.2）：影响面计数 / 重跑最小集的数据源。
 * 取代硬编码 switch 的思路：此处只做查询，不改写状态。
 */

export const NODE_GRAPH = {
  analyze: {
    produces: ["chapter_summaries", "characters", "locations", "clues"],
    consumes: ["source_chapters"],
  },
  "bible.propose": {
    produces: ["style_bibles"],
    consumes: ["chapter_summaries", "characters", "locations", "clues"],
  },
  condense: {
    produces: ["condensed_chapters"],
    consumes: ["style_bibles", "clues", "source_chapters"],
  },
  adapt: {
    produces: ["adapted_chapters", "beats"],
    consumes: ["style_bibles", "clues", "source_chapters", "condensed_chapters"],
  },
  "assets-phase1": { produces: ["assets", "asset_requests"], consumes: ["characters", "locations"] },
  "assets-phase2": { produces: ["assets", "asset_requests"], consumes: ["assets"] },
  storyboard: { produces: ["shots", "shot_layers", "timelines"], consumes: ["beats", "assets"] },
  voice: { produces: ["voice_takes", "assets"], consumes: ["beats", "voice_profiles"] },
  render: { produces: ["render_jobs", "episodes"], consumes: ["timelines", "assets", "voice_takes"] },
} as const;

export type GraphNode = keyof typeof NODE_GRAPH;

export interface NodeEstimate {
  node: GraphNode;
  llmCalls: number;
  imageCalls: number;
  ttsCalls: number;
  estSeconds: [number, number];
  /** 将被覆盖的现存数据（行数） */
  overwrites: Array<{ table: string; count: number }>;
  /** 是否可回滚（staging 审阅或 checkpoint 兜底） */
  reversible: boolean;
  /** 是否走逐条审阅（staged） */
  staged: boolean;
  /** 风险闸门（docs/07 I3）：auto / notify / block */
  gate: "auto" | "notify" | "block";
  blockers: string[];
}

/** 风险闸门（docs/07 I3）：按“对世界做了什么”分级，不看模型置信度 */
export const NODE_GATE: Record<GraphNode, "auto" | "notify" | "block"> = {
  analyze: "notify",
  "bible.propose": "notify",
  condense: "notify",
  adapt: "block",
  "assets-phase1": "notify",
  "assets-phase2": "notify",
  storyboard: "block",
  voice: "notify",
  render: "auto",
};

/** 结构化影响预报（docs/06 §4.3）：UI 据此渲染 PlanSheet，文案生成在 UI 层 */
export async function estimateNode(bookId: string, node: GraphNode): Promise<NodeEstimate> {
  const s = getSupabaseAdmin();
  const base: NodeEstimate = {
    node,
    llmCalls: 0,
    imageCalls: 0,
    ttsCalls: 0,
    estSeconds: [0, 0],
    overwrites: [],
    reversible: node === "adapt" || node === "storyboard",
    staged: node === "adapt" || node === "storyboard",
    gate: NODE_GATE[node],
    blockers: [],
  };

  switch (node) {
    case "analyze": {
      const { data: ch } = await s.from("source_chapters").select("char_count").eq("book_id", bookId).eq("idx", 1).single();
      base.llmCalls = 2;
      // 实测校准（docs/06 附录 F）：2674 字章节 17~21s
      base.estSeconds = [15, 30];
      if (!ch) base.blockers.push("还没有上传章节");
      return base;
    }
    case "bible.propose": {
      const { data: summary } = await s.from("chapter_summaries").select("id").eq("book_id", bookId).limit(1).maybeSingle();
      const { data: style } = await s.from("style_bibles").select("id").eq("book_id", bookId).limit(1).maybeSingle();
      base.llmCalls = 1;
      base.estSeconds = [20, 60];
      if (!summary) base.blockers.push("还没有章节摘要，请先分析章节");
      if (style) base.overwrites.push({ table: "style_bibles", count: 1 });
      return base;
    }
    case "condense": {
      const { data: ch } = await s.from("source_chapters").select("char_count").eq("book_id", bookId).eq("idx", 1).single();
      base.llmCalls = 1;
      base.estSeconds = [20, 90];
      if (!ch) base.blockers.push("还没有上传章节");
      const { data: existing } = await s.from("condensed_chapters").select("id").eq("book_id", bookId).limit(1).maybeSingle();
      if (existing) base.overwrites.push({ table: "condensed_chapters", count: 1 });
      return base;
    }
    case "adapt": {
      const { data: ch } = await s.from("source_chapters").select("char_count").eq("book_id", bookId).eq("idx", 1).single();
      const { data: style } = await s.from("style_bibles").select("id").eq("book_id", bookId).eq("status", "approved").limit(1).maybeSingle();
      base.llmCalls = 2;
      // 实测校准：258~390s（含校验重试与确定性修复；模型输出不稳定是常态）
      base.estSeconds = [120, 420];
      if (!ch) base.blockers.push("还没有上传章节");
      if (!style) base.blockers.push("风格方案尚未批准（签核 A）");
      const { data: adapted } = await s.from("adapted_chapters").select("id").eq("book_id", bookId).limit(1).maybeSingle();
      if (adapted) {
        const { data: beats } = await s.from("beats").select("id").eq("adapted_chapter_id", adapted.id);
        base.overwrites.push({ table: "beats", count: beats?.length ?? 0 });
      }
      return base;
    }
    case "assets-phase1":
    case "assets-phase2": {
      try {
        const plan = await import("@/lib/pipeline/nodes/assets").then((m) => m.listAssetPlan(bookId));
        const specs = (node === "assets-phase1" ? plan.phase1 : plan.phase2).filter((x) => !x.skipReason);
        base.imageCalls = specs.length;
        base.estSeconds = [specs.length * 15, specs.length * 25];
        if (specs.length === 0) base.blockers.push("生成计划为空");
      } catch (err) {
        base.blockers.push(err instanceof Error ? err.message : String(err));
      }
      return base;
    }
    case "storyboard": {
      const { data: shots } = await s.from("shots").select("id").eq("book_id", bookId);
      base.estSeconds = [2, 6];
      base.overwrites.push({ table: "shots", count: shots?.length ?? 0 });
      const [{ data: adapted }, { data: background }] = await Promise.all([
        s.from("adapted_chapters").select("id, status").eq("book_id", bookId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        s.from("assets").select("id").eq("book_id", bookId).eq("kind", "background").eq("status", "approved").limit(1).maybeSingle(),
      ]);
      if (!adapted) base.blockers.push("还没有改编脚本（签核 B）");
      else if (adapted.status !== "approved") base.blockers.push("改编脚本尚未批准（签核 B）");
      if (!background) base.blockers.push("还没有已批准的背景图（签核 C）");
      return base;
    }
    case "voice": {
      const [{ data: adapted }, { data: beats }] = await Promise.all([
        s.from("adapted_chapters").select("id, status").eq("book_id", bookId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        s.from("beats").select("id").eq("book_id", bookId),
      ]);
      const n = beats?.length ?? 0;
      base.ttsCalls = n;
      // 实测校准：32 句 29s（串行 TTS+ASR，单句 <1s）
      base.estSeconds = [Math.max(15, n * 1), Math.max(40, n * 2)];
      if (!adapted) base.blockers.push("还没有改编脚本（签核 B）");
      else if (adapted.status !== "approved") base.blockers.push("改编脚本尚未批准（签核 B）");
      if (n === 0) base.blockers.push("还没有 beats");
      return base;
    }
    case "render": {
      const [{ data: timeline }, { data: takes }] = await Promise.all([
        s.from("timelines").select("id").eq("book_id", bookId).eq("status", "approved").limit(1).maybeSingle(),
        s.from("voice_takes").select("id").eq("book_id", bookId).eq("status", "accepted").limit(1).maybeSingle(),
      ]);
      if (!timeline) base.blockers.push("还没有已批准的分镜（签核 D）");
      if (!takes) base.blockers.push("还没有已批准的配音（签核 E）");
      return base;
    }
    default:
      return base;
  }
}

/** 下游影响计数：改某行会让哪些下游过期（stale 溯源用） */
export async function downstreamImpact(bookId: string, table: string, rowId: string): Promise<Array<{ table: string; count: number }>> {
  const s = getSupabaseAdmin();
  const out: Array<{ table: string; count: number }> = [];
  switch (table) {
    case "style_bibles":
    case "clues": {
      const { data: chapters } = await s.from("adapted_chapters").select("id").eq("book_id", bookId).eq("status", "stale");
      out.push({ table: "adapted_chapters", count: chapters?.length ?? 0 });
      break;
    }
    case "adapted_chapters": {
      const { data: shots } = await s.from("shots").select("id").eq("book_id", bookId);
      out.push({ table: "shots", count: shots?.length ?? 0 });
      const { data: timelines } = await s.from("timelines").select("id").eq("book_id", bookId).eq("status", "stale");
      out.push({ table: "timelines", count: timelines?.length ?? 0 });
      break;
    }
    case "beats": {
      const { data: shots } = await s.from("shots").select("id").eq("beat_id", rowId);
      out.push({ table: "shots", count: shots?.length ?? 0 });
      const { data: takes } = await s.from("voice_takes").select("id").eq("beat_id", rowId);
      if ((takes?.length ?? 0) > 0) out.push({ table: "voice_takes", count: takes?.length ?? 0 });
      break;
    }
    case "shots": {
      const { data: timelines } = await s.from("timelines").select("id").eq("book_id", bookId);
      out.push({ table: "timelines", count: timelines?.length ?? 0 });
      break;
    }
    case "timelines": {
      const { data: jobs } = await s.from("render_jobs").select("id").eq("book_id", bookId);
      out.push({ table: "render_jobs", count: jobs?.length ?? 0 });
      break;
    }
    default:
      break;
  }
  return out;
}
