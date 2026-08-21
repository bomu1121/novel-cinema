"use client";

export interface ErrorBannerProps {
  message?: string | null;
  onDismiss?: () => void;
  className?: string;
}

/** 统一错误横幅（替换 9 处手写红 div）。空消息不渲染。 */
export function ErrorBanner({ message, onDismiss, className = "" }: ErrorBannerProps) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={`flex items-start justify-between gap-3 rounded-lg border border-stale/40 bg-stale/10 px-4 py-3 text-sm text-stale ${className}`}
    >
      <p className="min-w-0 break-words">{message}</p>
      {onDismiss && (
        <button
          type="button"
          aria-label="关闭错误提示"
          onClick={onDismiss}
          className="flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded-md text-base leading-none opacity-60 hover:bg-stale/10 hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );
}
