"use client";

import Link from "next/link";
import { Select } from "@/components/ui/select";

export interface ChapterOption {
  id: string;
  idx: number;
  title: string | null;
  char_count: number;
}

interface ChapterPickerProps {
  chapters: ChapterOption[];
  value: string | null;
  onChange: (chapterId: string) => void;
  label: string;
  /** 返回当前章的状态文案；没有则返回 null */
  status?: (chapterId: string) => string | null;
  /** 章节工作区入口；传入后显示“监控”链接 */
  workspaceHref?: string;
  className?: string;
}

/**
 * 紧凑的单章选择器：一个下拉 + 当前章节状态，替代页面里整块章节卡片列表。
 * 用于 bible / condense / script 等“按单章执行”的页面。
 */
export function ChapterPicker({
  chapters,
  value,
  onChange,
  label,
  status,
  workspaceHref,
  className = "",
}: ChapterPickerProps) {
  const selected = chapters.find((c) => c.id === value) ?? null;
  const statusText = selected && status ? status(selected.id) : null;

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm ${className}`}
    >
      <span className="text-xs text-text-muted">{label}</span>
      <Select
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-48 flex-1 sm:flex-none"
      >
        <option value="">请选择章节</option>
        {chapters.map((ch) => (
          <option key={ch.id} value={ch.id}>
            第 {ch.idx} 章{ch.title ? ` · ${ch.title}` : ""}
          </option>
        ))}
      </Select>
      {selected && (
        <span className="text-xs text-text-muted">{selected.char_count.toLocaleString()} 字</span>
      )}
      {statusText && (
        <span className="rounded-full bg-approved/10 px-2 py-0.5 text-xs text-approved">
          {statusText}
        </span>
      )}
      {workspaceHref && (
        <Link
          href={workspaceHref}
          className="ml-auto text-xs text-accent underline underline-offset-2 hover:text-accent-hover"
        >
          章节监控 →
        </Link>
      )}
    </div>
  );
}
