"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface ChapterSummary {
  id: string;
  idx: number;
  kind: string;
  title: string | null;
  char_count: number;
  status: string;
}

interface BookDetail {
  id: string;
  title: string;
  status: string;
  total_chars: number;
  created_at: string;
}

export default function BookDetailPage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;

  const [book, setBook] = useState<BookDetail | null>(null);
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/books/${bookId}/chapters`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setBook(data.book);
        setChapters(data.chapters ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">
        ← 返回项目列表
      </Link>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {book && (
        <header>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">{book.title}</h1>
            <div className="flex gap-2">
              <Link
                href={`/books/${bookId}/bible`}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:border-zinc-900"
              >
                全书档案 / 签核 A →
              </Link>
              <Link
                href={`/books/${bookId}/script`}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:border-zinc-900"
              >
                改编脚本 / 签核 B →
              </Link>
              <Link
                href={`/books/${bookId}/assets`}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:border-zinc-900"
              >
                资产库 / 签核 C →
              </Link>
              <Link
                href={`/books/${bookId}/storyboard`}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:border-zinc-900"
              >
                分镜时间轴 / 签核 D →
              </Link>
              <Link
                href={`/books/${bookId}/voice`}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:border-zinc-900"
              >
                多角色配音 / 签核 E →
              </Link>
            </div>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {book.total_chars.toLocaleString()} 字 · {chapters.length} 章 · 状态 {book.status}
          </p>
        </header>
      )}

      <ul className="space-y-2">
        {chapters.map((ch) => (
          <li
            key={ch.id}
            className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 text-sm"
          >
            <span>
              {ch.kind === "front" ? "前言" : `第 ${ch.idx} 章`}
              {ch.title ? ` · ${ch.title}` : ""}
            </span>
            <span className="text-zinc-500">
              {ch.char_count.toLocaleString()} 字 · {ch.status}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
