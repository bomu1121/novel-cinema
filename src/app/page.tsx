"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusPill } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";

interface BookSummary {
  id: string;
  title: string;
  status: string;
  total_chars: number;
  created_at: string;
}

interface UploadResult {
  book?: { id: string; title: string };
  encoding?: string;
  warnings?: string[];
  totalChars?: number;
  report?: {
    removedLines: number;
    dedupedLines: number;
    tailRemoved: boolean;
    mergedLineBreaks: number;
    tocLinesSkipped: number;
  };
  chapters?: Array<{ idx: number; kind: string; title: string | null; charCount: number }>;
}

export default function HomePage() {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadBooks = useCallback(async () => {
    try {
      const res = await fetch("/api/books");
      const data = await res.json();
      setBooks(data.books ?? []);
      setListError(data.error ?? null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // 挂载后拉取项目列表；异步回调中 setState，不构成同步级联渲染
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBooks();
  }, [loadBooks]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.elements.namedItem("file") as HTMLInputElement;
    const titleInput = form.elements.namedItem("title") as HTMLInputElement;
    const file = droppedFile ?? input.files?.[0];
    if (!file) {
      setError("请先选择一个 .txt 文件");
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.set("file", file);
      if (titleInput.value.trim()) body.set("title", titleInput.value.trim());

      const res = await fetch("/api/books", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `上传失败（HTTP ${res.status}）`);
        return;
      }
      setResult(data);
      form.reset();
      setDroppedFile(null);
      setSelectedFileName(null);
      await loadBooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <PageShell size="narrow" className="space-y-8">
      <PageHeader
        title="小说影像化工作台"
        description="上传一章 txt → 分析 → 改编 → 资产生成 → 配音 → 渲染，产出可发布的视频作品。M0 阶段先打通上传、清洗与切章。"
      />

      <section className="rounded-xl border border-accent/20 bg-accent-soft/40 p-6 sm:p-8">
        <p className="text-overline font-medium uppercase tracking-widest text-accent">AI 影像化工作台</p>
        <h2 className="mt-1 font-display text-display font-semibold tracking-tight text-text">
          把小说变成影像
        </h2>
        <p className="mt-2 max-w-2xl text-body leading-6 text-text-muted">
          上传一章 txt，经过全书理解、章节改编、分层资产、多角色配音与确定性渲染，产出可发布的视频作品。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {["分析", "改编", "资产", "配音", "渲染"].map((step, i) => (
            <span
              key={step}
              className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-surface px-2.5 py-1 text-caption text-accent"
            >
              <span className="font-mono text-[10px]">{i + 1}</span>
              {step}
            </span>
          ))}
        </div>
      </section>

      <form
        onSubmit={onSubmit}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) {
            setDroppedFile(file);
            setError(null);
          }
        }}
        className={`space-y-4 rounded-xl border p-6 transition-colors duration-fast ${
          dragOver ? "border-accent bg-accent-soft/40" : "border-border"
        }`}
      >
        <Field label="书名（可选，默认取文件名）" htmlFor="title">
          <Input id="title" name="title" placeholder="例如：雨夜疑案（可选）" />
        </Field>

        <div>
          <span className="text-overline font-medium uppercase tracking-widest text-text-muted">
            .txt 文件（≤ 50MB）
          </span>
          <label
            htmlFor="file"
            className={`mt-2 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors duration-fast ${
              dragOver
                ? "border-accent bg-accent-soft/40"
                : selectedFileName
                  ? "border-accent/60 bg-accent-soft/20 hover:border-accent hover:bg-accent-soft/30"
                  : "border-border hover:border-accent/50 hover:bg-surface-1"
            }`}
          >
            <input
              ref={fileInputRef}
              id="file"
              name="file"
              type="file"
              accept=".txt,text/plain"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                if (file) {
                  setDroppedFile(file);
                  setSelectedFileName(file.name);
                  setError(null);
                }
                e.target.value = "";
              }}
            />
            <span
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-fast ${
                dragOver ? "bg-accent text-on-accent" : "bg-accent/10 text-accent"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path d="M12 16V4" />
                <path d="m6 10 6-6 6 6" />
                <path d="M4 20h16" />
              </svg>
            </span>
            <span className="mt-3 text-body font-medium text-text">
              {selectedFileName ?? (dragOver ? "松开以上传" : "选择或拖拽 .txt 文件")}
            </span>
            <span className="mt-1 text-caption text-text-muted">
              {selectedFileName ? "点击可重新选择" : "支持 .txt / text/plain，≤ 50MB"}
            </span>
          </label>
        </div>

        <Button
          type="submit"
          disabled={uploading}
          loading={uploading}
        >
          上传并解析
        </Button>
      </form>

      <ErrorBanner message={error} />

      {result && (
        <Card className="border-approved/40 bg-approved/10 text-sm">
          <h2 className="font-semibold text-approved">解析完成</h2>
          <p className="mt-1 text-approved/80">
            编码：{result.encoding} · 章节数：{result.chapters?.length ?? 0} · 总字数：{(result.totalChars ?? 0).toLocaleString()}
          </p>
          {result.report && (
            <p className="mt-1 text-approved/80">
              清洗：删除水印/符号 {result.report.removedLines} 行 · 去重 {result.report.dedupedLines} 行 ·
              合并断行 {result.report.mergedLineBreaks} 处
              {result.report.tocLinesSkipped > 0 ? ` · 跳过目录 ${result.report.tocLinesSkipped} 行` : ""}
              {result.report.tailRemoved ? " · 已移除文末“全文完”标记" : ""}
            </p>
          )}
          {result.book && (
            <Link
              href={`/books/${result.book.id}`}
              className="mt-3 inline-block rounded-lg bg-approved px-3 py-1.5 text-inverse hover:bg-approved/85"
            >
              查看章节 →
            </Link>
          )}
          {result.warnings && result.warnings.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-regen">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <section>
        <h2 className="mb-3 font-semibold">项目（books）</h2>
        {listError && (
          <p className="mb-3 text-sm text-regen">
            无法读取列表：{listError}（请检查 .env.local 中 SUPABASE_* 配置）
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {books.map((book) => (
            <Link key={book.id} href={`/books/${book.id}`} className="block">
              <Card interactive className="h-full">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text">{book.title}</span>
                  <StatusPill table="books" status={book.status} />
                </div>
                <p className="mt-1 text-caption text-text-muted">{book.total_chars.toLocaleString()} 字</p>
              </Card>
            </Link>
          ))}
          {books.length === 0 && !listError && (
            <div className="sm:col-span-2">
              <EmptyState description="还没有项目，先上传一章试试。" />
            </div>
          )}
        </div>
      </section>
    </PageShell>
  );
}
