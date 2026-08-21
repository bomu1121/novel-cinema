<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI 约定（改任何界面前必读 docs/06-ui-optimization-plan.md）

- 颜色/间距/圆角/动效一律用 `globals.css` 的 `@theme` 令牌，禁止字面量（#hex、`bg-[#`、`duration-[`）。
- 状态渲染必须过 `src/lib/ui/status.ts`：审阅态用 `toReviewStatus()` + `<StatusPill>`，
  执行态归进度 chip，`clue_status`/`project_status` 用中性 chip，禁止裸 DB status 文本。
- 枚举常量从 `@/lib/ui/enums` 导入，禁止在页面里重复定义。
- 基础组件复用 `@/components/ui/*`（Button / ErrorBanner / StatusPill / SectionCard），禁止复制样式串。
- 长任务一律走 jobs 队列 + SSE，禁止在 route handler 里同步 await AI 节点（P1 起生效）。
- 破坏性写操作前必须建 checkpoint（`@/lib/checkpoints`）；`estimate().reversible` 必须反映真实情况。
- 新组件默认无障碍：≥24px 命中区、aria-live 播报、reduced-motion 兜底。
- 改完 UI 跑 `npm run lint:ui`；组件改动跑 `npm run test:ui`。
