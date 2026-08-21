"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusPill } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

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
      await loadBooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <PageHeader
        title="小说影像化工作台"
        description="M0 阶段：上传一章 txt → 编码探测 + 清洗 + 切章。后续节点按 docs/02 流水线逐步接入。"
      />

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
          <Input id="title" name="title" placeholder="例如：雨夜疑案" />
        </Field>

        <Field label=".txt 文件（≤ 50MB）" htmlFor="file" hint={droppedFile ? `已选择：${droppedFile.name}` : dragOver ? "松开以上传" : "也可以把文件拖进这个区域"}>
          <Input
            id="file"
            name="file"
            type="file"
            accept=".txt,text/plain"
            className="pt-1.5 text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-invert file:px-4 file:py-2 file:text-sm file:text-inverse"
          />
        </Field>

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
            编码：{result.encoding} · 章节数：{result.chapters?.length ?? 0}
          </p>
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
    </main>
  );
}
