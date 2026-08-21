/**
 * jobs 域模型（docs/06 §4.1 job-first 可观测执行）。
 * 状态机：pending → running → succeeded | failed | cancelled
 * 事件流（job_events）：step / progress / log / done / error，SSE 按 seq 重放。
 */

export type JobPhase = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export const JOB_PHASES: JobPhase[] = ["pending", "running", "succeeded", "failed", "cancelled"];

export type JobEventKind = "step" | "progress" | "log" | "done" | "error";

export interface JobEvent {
  id: number;
  seq: number;
  kind: JobEventKind;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface JobSnapshot {
  id: string;
  bookId: string;
  node: string;
  status: JobPhase;
  progress: number;
  step: string | null;
  stepIndex: number;
  stepTotal: number;
  error: string | null;
  inputRef: Record<string, unknown>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * 进度上报器：节点函数（可选参数）在自然阶段点调用。
 * 禁止在没有真实分母时伪造百分比——只有阶段与已用时。
 */
export interface ProgressReporter {
  /** 进入一个新阶段。index/total 为该阶段的真实计数（如第 5/8 句）。 */
  step(label: string, index?: number, total?: number): void;
  /** 自由文本日志行 */
  log(line: string): void;
  /** 0..1 整体进度（有真实依据时调用） */
  progress(value: number): void;
  /** true = 用户请求取消，调用方应在安全点中止 */
  checkCancelled(): boolean;
}

export const NOOP_REPORTER: ProgressReporter = {
  step() {},
  log() {},
  progress() {},
  checkCancelled() {
    return false;
  },
};

/** 协作式取消：节点在安全点 checkCancelled() 为 true 时抛出此错误，worker 记为 cancelled */
export class JobCancelledError extends Error {
  constructor() {
    super("任务已取消");
    this.name = "JobCancelledError";
  }
}
