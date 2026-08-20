# novel-cinema

小说 → AI 影像化工作台。目标：上传一本无版权风险的 txt 小说，经“全书理解 → 章节改编 → 分层资产生成 → 多角色配音 → 确定性渲染”，产出 1 小时全书 master 视频，并在幕边界切分发布。

当前阶段：**M0 单章垂直切片**（3000 字、2 角色、3 分钟成片）。

## 文档

- [docs/00-decisions.md](docs/00-decisions.md) — 产品与技术决策基线
- [docs/01-data-model-v0.md](docs/01-data-model-v0.md) — 数据模型 v0
- [docs/02-pipeline-v0.md](docs/02-pipeline-v0.md) — 流水线定义 v0（节点/提示词/校验/重试）
- [docs/03-m0-roadmap.md](docs/03-m0-roadmap.md) — M0 任务拆分与验收标准

## 技术栈

Next.js 16 (App Router) + TypeScript + Supabase (Postgres + pgvector) + Cloudflare R2 + 托管队列（M1 接入）+ FFmpeg 渲染。

## 环境变量

```bash
cp .env.example .env.local
```

必填（按当前进度逐步使用）：`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`，`R2_*`，`LLM_*`。其余到对应 M0 节点再填。

## 数据库迁移

Schema 在 [supabase/migrations/0001_schema.sql](supabase/migrations/0001_schema.sql)。

```bash
# 使用 Supabase CLI
npx supabase db push

# 或本地 Supabase stack
npx supabase start
npx supabase db reset
```

> 迁移文件启用了 RLS 并引用 `auth.users`，因此目标是 Supabase 环境，不是裸 Postgres。

## 开发

```bash
npm run dev     # http://localhost:3000
npm run lint
npm run build
```

## M0 进度

- [x] T0 脚手架 + 依赖 + env/DB/R2 基础封装
- [x] T1 Schema v0 迁移文件
- [ ] T2 上传 + 清洗切章
- [ ] T3 LLM 适配器
- [ ] T4 单章分析 + 档案页
- [ ] T5 章节改编 + 审校台
- [ ] T6 图像适配器 + 资产库
- [ ] T7 分镜生成 + 预览
- [ ] T8 配音 + ASR
- [ ] T9 本地渲染
- [ ] T10 端到端联调 + 成本报告
