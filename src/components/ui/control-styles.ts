/**
 * 统一表单控件样式（docs/08 + 输入框重构调研）：
 * - hover：边框加深，不跳动
 * - focus：细 ring（2px/25%）+ 边框强调色，表单控件始终显示 focus（不只用 focus-visible）
 * - 输入光标 caret 跟随品牌色；文本选中使用品牌色背景
 * - 错误：红色边框 + 红色柔 ring；禁用：灰底、灰字、not-allowed
 */

export const CONTROL_BASE =
  "h-10 w-full rounded-md border bg-surface px-3 text-body text-text caret-accent " +
  "placeholder:text-text-subtle transition-all duration-fast " +
  "focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent " +
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-muted " +
  "selection:bg-accent selection:text-on-accent";

export function controlBorder(invalid: boolean): string {
  return invalid
    ? "border-stale hover:border-stale/80 focus:border-stale focus:ring-stale/20"
    : "border-border hover:border-border-strong active:border-accent/60 focus:border-accent focus:ring-accent/25";
}
