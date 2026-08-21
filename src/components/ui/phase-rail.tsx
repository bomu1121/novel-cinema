"use client";

/**
 * 流程铁路（docs/08 §4.2 / §5.7）：A–F 六个签核点的阶段指示。
 */
export interface PhaseRailProps {
  current: number; // 1..6
  labels?: string[];
  className?: string;
}

const DEFAULT_LABELS = ["档案", "改编", "资产", "分镜", "配音", "渲染"];

export function PhaseRail({ current, labels = DEFAULT_LABELS, className = "" }: PhaseRailProps) {
  return (
    <ol className={`flex items-center gap-2 ${className}`} aria-label="签核流程">
      {labels.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={active ? "step" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption ${
                active
                  ? "border-accent bg-accent-soft text-accent"
                  : done
                    ? "border-approved/40 bg-approved/10 text-approved"
                    : "border-border bg-surface-2 text-text-subtle"
              }`}
            >
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${
                  active ? "bg-accent" : done ? "bg-approved" : "bg-border-strong"
                }`}
              />
              {label}
            </span>
            {i < labels.length - 1 && <span aria-hidden className="h-px w-3 bg-border-strong" />}
          </li>
        );
      })}
    </ol>
  );
}
