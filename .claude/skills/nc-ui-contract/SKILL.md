---
name: nc-ui-contract
description: >
  Use when writing or modifying any UI in the novel-cinema project — React
  components, pages, Tailwind classes, or CSS. Enforces the project design
  tokens, the three-family status semantics, motion duration tiers,
  accessibility baseline, and Chinese copy conventions. Rejects hardcoded
  colors and durations. Always run the bundled lint script after UI changes.
allowed-tools: [Read, Grep, Edit, Write, Bash]
---

# novel-cinema UI 契约

写任何 UI 前先读 `references/tokens.md` 与 `references/status-map.md`。

## 硬性规则（违反即返工）

1. **禁止硬编码颜色**。只用 `--color-*` 令牌（`bg-surface` / `text-text-muted` /
   `border-approved` 等）；新增颜色必须先加令牌（`src/app/globals.css` 的 `@theme`）。
2. **禁止硬编码动效时长**。只用 `--dur-instant|fast|base|slow`（对应 `duration-instant|fast|base|slow`），
   对齐 Material 3 三档（short 50-200 / medium 200-400 / long 400-700ms）。
3. **状态分三族**（`docs/06` §5.3）：
   - 审阅态 → `toReviewStatus(table, s)` + `<StatusPill>`（返回 null 就别画徽章）；
   - 执行态（pending/running/succeeded/failed/cancelled）→ `<StatusPill>` 自动渲染进度 chip；
   - 领域语义（clue_status / project_status）→ 中性 chip，**禁止套状态色**。
   任何情况下不许直接输出 DB 的 status 字符串。
4. **异步操作三段式**：乐观反馈（<100ms）→ 阶段进度（`<Button loading>` / `<StatusPill>`）→
   终态 toast（`useToast`，带撤销入口）。禁止「…中」文案（用固定文案 + `loading` prop）。
5. **可达性**：可点元素 ≥24×24px（`min-h-6 min-w-6`，主按钮 36px）；状态变化经
   `aria-live`（Toast 已内置）；新动画必须在 `prefers-reduced-motion: reduce` 下失效；
   错误信息用 `role="alert"`。
6. **文案**：中文、动词开头、写清对象与影响范围（例：「已替换林晚的表情图 · 影响 1 个镜头」），
   不用「操作成功」这类空话。
7. **不新增重复实现**：改 UI 前先查 `docs/06` §1.5 的重复清单；枚举常量一律从
   `@/lib/ui/enums` 导入；基础组件一律复用 `@/components/ui/*`。
8. **破坏性操作**：写库前必须建 checkpoint（`@/lib/checkpoints`），`estimate().reversible`
   必须反映真实情况。

## 复核清单（提交前自查）

- [ ] 无 `bg-[#`、无 `duration-[`、无 `#hex` 颜色字面量
- [ ] 无「…中」loading 文案三元
- [ ] 无裸 `status` 文本渲染、无本地枚举重复定义
- [ ] 新交互可纯键盘完成
- [ ] 破坏性操作有 checkpoint，且 `reversible` 是真实值

## 收尾

```bash
npm run lint:ui
```

参考：`references/tokens.md`、`references/status-map.md`、`references/copy.md`
