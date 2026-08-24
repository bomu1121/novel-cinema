# 11 · 视频向章节精简（condense.chapter）v0

> 目标：把一章原文精简成**服务于视频制作的叙事底稿**，并提供“原文 ↔ 精简稿”对照页 + 手动修正。
> 关键定位：**不是摘要**。摘要会抽象化；视频精简必须保留可拍摄的对白、动作、物件与线索。

## 1. 调研依据（2026-08）

| 原则 | 来源 |
|---|---|
| 删内心独白/环境铺陈/重复描写；保对白、外显动作、冲突 | [Fiveable: Condensing and Expanding Narratives](https://frontend.prod.fiveable.me/advanced-screenwriting/unit-5/condensing-expanding-narratives/study-guide/x7XEZGEXgERGVEtc) |
| 小说→剧本的取舍实践 | [From Book to Screen](https://www.gilliamwritersgroup.com/blog/from-book-to-screen-approaching-adaptations)、[Screenweaver: novel → screenplay](https://www.screenweaver.ai/blog/adapt-novel-to-screenplay) |
| 精简版与原文保持事件/线索可对齐（source_span） | [EMNLP 2023: Analyzing Film Adaptation through Narrative Alignment](https://aclanthology.org/2023.emnlp-main.962/) |
| 国内网文→短视频工业化改编实践 | [AI大模型驱动：网络小说到短视频剧本](http://www.ldpk.cn/news/23322)、[小说→九列分镜表完整 Prompt](https://blog.csdn.net/weixin_45463545/article/details/161791730) |
| 与 C10 改编约束一致的内部基线 | `docs/02-pipeline-v0.md` §4.4 |

## 2. 提示词核心（实现见 `src/lib/pipeline/prompts/condense.ts`）

- 禁止概括转述：“两人展开调查”不得替代具体对白/动作。
- 对白优先保留原句；只删语气词与重复回合。
- 只保留可拍摄内容：动作、对白、关键物件、空间变化、线索。
- 删除不可拍摄或非关键内容：内心独白、重复描写、环境铺陈、寒暄过渡。
- 压缩手法优先级：删除 → 合并同场景 → 微缩原句；禁止新增事实与改变因果顺序。
- 每段必须带 `source_spans`，`quote` 逐字来自原文。
- 未回收线索的引入点必须保留；本章回收的线索必须保留回收点。

## 3. 数据模型

`condensed_chapters`（SQLite 自动建表）：

- `source_chapter_id` unique —— 一章一份底稿。
- `condensed_text` —— 可直接编辑的纯文本底稿。
- `source_chars / target_chars / ratio` —— 预算与压缩率。
- `status`：`draft → pending_review → approved / stale`。
- `hand_edited` —— 是否被人工改过。
- `raw_output / report` —— AI 原始 JSON 与取舍报告（kept/cut/compressed/clue_safety_notes/risks）。

## 4. 确定性校验（不靠模型自觉）

- 总字数在 `target ±（下限 60%、上限 115%）` 区间；
- 每个 `source_span` 边界合法，且 `quote` 规范化后能在原文逐字定位；
- 段落 `idx` 连续；
- 校验失败把错误列表喂回模型重试，最多 3 轮；仍失败则任务失败并保留最后输出。

## 5. 页面与人工修正

`/books/[bookId]/condense`：

- 左侧：原文只读；右侧：精简底稿 textarea 可编辑。
- 顶部显示目标字数、当前字数、压缩率、审阅状态。
- “运行 AI 精简”走 jobs 队列 + SSE（不阻塞 route handler）。
- 手动保存：先建 checkpoint → 更新 `condensed_text` → 下游 `adapted_chapters` 标 stale。
- 批准后：`adapt` 节点自动优先使用 `condensed_text` 作为改编输入，`adapted_chapters.basis='condensed'`，脚本页标注“输入：精简底稿”。

## 6. 默认压缩率

- 默认 **35%**（3000 字 → 约 1050 字），与 M0 180s 成片预算匹配。
- `targetCharsForSource()` 夹在 400~6000 字；后续如需可调，把 `ratio` 放入 job input。
