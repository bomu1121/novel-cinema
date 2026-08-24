# 10 · 上传/清洗环节调研后待办（暂缓项）

> 状态：调研已完成（2026-08），结论已同步；当前判定**非高优先级**，统一挂起，不做排期。
> 对应实现现状：`src/lib/pipeline/nodes/clean.ts`（规则融合 + TOC 识别 + 置信度护栏已落地）。

## 待办清单

- [ ] **编码探测置信度 + 低置信度人工兜底**
  - 参考：chardet 的多字节 prober（[how-it-works](https://chardet.readthedocs.io/en/6.0.0/how-it-works.html#multi-byte-encodings)）、chardetng（[README](https://github.com/hsivonen/chardetng/blob/6f91a2ee2804f0c563cb6b7b85ac17bff1adc842/README.md)）
  - 目标：输出 confidence；低于阈值时在 UI 提示并允许手动选编码，避免乱码进入流水线。
  - 可选方案：jschardet 第二意见 / chardetng WASM / 保持零依赖补评分与降级策略。

- [ ] **流式上传 + 临时文件落盘**
  - 现状：`request.formData()` → `file.arrayBuffer()` 整块读入内存（上限 50MB）。
  - 目标：`request.body` 流式解析（busboy 或手写 multipart）先落临时文件再清洗，降低内存峰值。
  - 参考：[Next.js 流式 multipart 处理](https://dev.to/grimshinigami/how-to-handle-large-filefiles-streams-in-nextjs-13-using-busboymulter-25gb)。

- [ ] **水印规则外置 + 去重参数化**
  - 现状：水印正则硬编码在 `WATERMARK_PATTERNS`，去重阈值硬编码（短行 ≥3 / 长行 ≥5）。
  - 目标：规则表（正则 + 说明 + 示例）移到配置或 DB，阈值可调，便于维护与调优。

- [ ] **近似去重（MinHash/SimHash）——M1 再评估**
  - 仅当出现“跨书语料 / 抄袭段 / 批量小说库”需求时再做。
  - 参考：[text-dedup](https://github.com/ChenghaoMou/text-dedup)、[Datatrove MinHash 管线](https://github.com/leeroopedia/workflow-huggingface-datatrove-minhash-deduplication)。

- [ ] **低置信度文件的段落消歧（cheap LLM）——M1 再评估**
  - 现状：段落重排为确定性启发式（行尾标点 + 800 字封顶），对诗歌/对白分行/列表排版可能过度合并。
  - 目标：仅当规则产生低置信度 warning 时，再按 `docs/02` 原则调 cheap LLM 做歧义消解。
  - 参考：[Segment Any Text](https://hcai.at/publications/2024_ACL_segment/)。

## 明确不做（或推迟）

- UAX #14 显示级断行：不解决 txt 段落还原问题，不引入。
- 图生视频 / LoRA / 多用户：与上传解析无关，不在本清单。
