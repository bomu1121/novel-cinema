"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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
    const file = input.files?.[0];
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
      await loadBooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header>
        <h1 className="text-2xl font-bold">小说影像化工作台</h1>
        <p className="mt-2 text-sm text-zinc-500">
          M0 阶段：上传一章 txt → 编码探测 + 清洗 + 切章。后续节点按 docs/02 流水线逐步接入。
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-zinc-200 p-6">
        <label className="block">
          <span className="text-sm font-medium">书名（可选，默认取文件名）</span>
          <input
            name="title"
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            placeholder="例如：雨夜疑案"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">.txt 文件（≤ 50MB）</span>
          <input
            name="file"
            type="file"
            accept=".txt,text/plain"
            className="mt-1 block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:text-white"
          />
        </label>

        <button
          type="submit"
          disabled={uploading}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {uploading ? "解析中…" : "上传并解析"}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-sm">
          <h2 className="font-semibold text-emerald-900">解析完成</h2>
          <p className="mt-1 text-emerald-800">
            编码：{result.encoding} · 章节数：{result.chapters?.length ?? 0}
          </p>
          {result.book && (
            <Link
              href={`/books/${result.book.id}`}
              className="mt-3 inline-block rounded-lg bg-emerald-700 px-3 py-1.5 text-white"
            >
              查看章节 →
            </Link>
          )}
          {result.warnings && result.warnings.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-700">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 font-semibold">项目（books）</h2>
        {listError && (
          <p className="mb-3 text-sm text-amber-700">
            无法读取列表：{listError}（请检查 .env.local 中 SUPABASE_* 配置）
          </p>
        )}
        <ul className="space-y-2">
          {books.map((book) => (
            <li key={book.id}>
              <Link
                href={`/books/${book.id}`}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 text-sm hover:border-zinc-400"
              >
                <span className="font-medium">{book.title}</span>
                <span className="text-zinc-500">
                  {book.total_chars.toLocaleString()} 字 · {book.status}
                </span>
              </Link>
            </li>
          ))}
          {books.length === 0 && !listError && (
            <li className="text-sm text-zinc-400">还没有项目，先上传一章试试。</li>
          )}
        </ul>
      </section>
    </main>
  );
}
