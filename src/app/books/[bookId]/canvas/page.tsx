"use client";

import dynamic from "next/dynamic";

const Canvas = dynamic(() => import("@/components/storyboard-canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center text-sm text-text-muted">
      画布加载中…
    </div>
  ),
});

export default function CanvasPage() {
  return <Canvas />;
}
