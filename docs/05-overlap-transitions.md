# 05 · 重叠镜头与转场时间轴方案 v1

> 问题：现有渲染器把每个 shot 渲染成独立片段再 `concat -c copy`，crossfade 只是“前镜淡出到黑 + 后镜从黑淡入”的**假叠化**，两段画面从未同时出现在屏幕上。
> 方案：**分段渲染（保留图层动效）→ 边界过渡解析 → FFmpeg xfade 链做真实重叠混合 → concat 组 → 混音/字幕**。

## 1. 术语与语义（调研结论）

- **叠化/crossfade**：A、B 两段在时间轴上重叠 δ 秒，重叠区内 A 透明度 1→0、B 透明度 0→1，画面逐帧混合。
- **黑场过渡/dip**：同样重叠 δ 秒，但混合函数经过黑色（xfade 的 `fadeblack`）。
- **cut**：无重叠，硬切。
- 时间轴性质：N 段、重叠段总时长 = Σdᵢ − Σδᵢ（每个边界只算一次）。

参考：FFmpeg Xfade wiki（https://trac.ffmpeg.org/wiki/Xfade）、StackOverflow 多段 xfade 链 offset 公式、剪辑软件叠化转场实现原理。

## 2. 转场边界模型

每个镜头有 `transition_in / transition_out`，但“边界”只能有一个过渡，按优先级解析：

```
boundary(i) = next.transition_in != 'cut' ? next.transition_in : prev.transition_out
```

| 边界解析结果 | xfade 转场 | 默认重叠时长 | 说明 |
|---|---|---|---|
| `cut` | （硬切，concat） | 0 | 组边界 |
| `crossfade` | `fade` | 0.8s | 真实叠化 |
| `dip_to_black` | `fadeblack` | 0.6s | 叠化经黑 |
| `slide` | `slideleft` | 0.5s | 滑动叠化（第一版固定向左） |
| `fade_in` / `fade_out` | 全局首/尾淡入淡出 | 0.4s | 不属于边界重叠，作用于整片 |

## 3. 渲染流水线（v1 实现）

```
shots[]
  ├─ 1) 逐镜头渲染：buildShotGraph(..., trackFades=false)
  │       图层自身的入场/出场/呼吸动效保留；不再做“边界假淡入淡出”
  ├─ 2) 按边界分组：cut 切分小组；组内相邻镜头有重叠过渡
  ├─ 3) 组内合成：
  │       1 段 → 直用
  │       k 段 → xfade 链：[v0][v1]xfade=T1:duration=δ1:offset=o1[x1]
  │                [x1][v2]xfade=T2:duration=δ2:offset=o2[x2] ...
  │               offset 公式：o_i = 当前链时长 − δ_i
  ├─ 4) 组间 concat（硬切）
  ├─ 5) 全局首尾 fade（若首镜 fade_in / 末镜 fade_out）→ 烧字幕
  └─ 6) 音频照旧（voice adelay/amix/LoudNorm），随后 mux
```

总时长校验：`duration = Σ shot.duration − Σ boundary.overlap`。

## 4. 单镜头预览与全片一致性

- 单镜头预览（`/preview/shot`）不变：它展示的是“这一段素材”，边界转场在它之外。
- 全片渲染与预览共享同一套 `buildShotGraph`，保证“预览即所得”；唯一区别是 trackFades 开关。

## 5. 已知边界与下一步（重叠问题第二类：同框多人）

“重叠”还有另一层含义：**同一镜头内两个人物图层同时出现**（对话双方同框）。数据模型 `shot_layers` 本来就支持 N 层，v1 只缺“加层”入口。下一步：
- API：`POST /api/books/[bookId]/shots/[shotId]/layers`（创建第二人物层）
- 画布检查器：“+ 添加同框人物”按钮，自动给双人预设 rect（说话人 x=0.64 / 听者 x=0.36）与 z 顺序
- 分镜引擎：对话 beat 自动生成“说话人 + 听者反应”双图层

## 6. 验收标准

1. 3 镜头合成样本（cut + crossfade 0.8 + dip 0.6）：ffprobe 时长 = Σd − 1.4s；
2. 交叉溶解中点抽帧可见两个背景像素混合（非纯黑过渡）；
3. cut 边界保持硬切，无闪光/黑帧；
4. 单镜头预览、全片渲染共用渲染逻辑，行为一致。
