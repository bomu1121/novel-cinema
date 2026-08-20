# 01 · 数据模型 v0

> 目标：一套结构能同时承载“原文 → 全书档案 → 改编脚本 → 分层镜头 → 时间轴 → 渲染/分集”全链路。
> 原则：AI 只产出 JSON，所有 JSON 进表；渲染器只消费确定性快照；AI 模型信息（prompt/seed/参数）全部留痕。

## 1. 设计原则

1. **一切以 `book_id` 为边界**：所有表都挂在 book 下，单租户隔离与删除都简单。
2. **AI 输出双份保存**：规范化后写入业务表，同时保留 `raw_output jsonb` 原文，便于调试与回放。
3. **审定状态机统一**：`draft → pending_review → approved / rejected`，外加 `stale`（上游变更导致过期）。
4. **渲染只读快照**：`timelines.snapshot` 是渲染的唯一事实来源；AI 改动不会偷偷影响已渲染版本。
5. **资产不可删只能归档**：被 timeline 引用的资产只做 `archived`，保证旧版本可回放。
6. **每条 beat 必须带 `source_span`**：原文出处是忠实度检查与人工审片的基础。

## 2. 关系总览

```
book
 ├─ source_chapter ── chapter_summary
 ├─ character ── character_relation
 │             └─ voice_profile
 ├─ location / item / timeline_event / clue
 ├─ style_bible
 ├─ asset (← asset_request)
 ├─ adapted_chapter ── beat ── shot ── shot_layer
 │                             └─ voice_take
 ├─ chapter_context
 ├─ timeline ── episode ── render_job
 ├─ review_task / job
```

## 3. 枚举类型

```sql
create type project_status as enum ('draft','analyzing','scripting','asset_ready','rendering','completed','failed');
create type artifact_status as enum ('draft','pending_review','approved','rejected','stale');
create type asset_status as enum ('generating','candidate','approved','rejected','archived');
create type asset_kind as enum ('character_ref','expression','pose','background','prop','text_card','bgm','sfx','voice_sample','cover','video');
create type asset_source as enum ('generated','imported');
create type voice_role as enum ('narrator','narrator_alt','character');
create type beat_type as enum ('narration','dialogue','action','insert_card','montage','transition');
create type speaker_type as enum ('narrator','character','onscreen_text','none');
create type layer_kind as enum ('background','character','prop','text','overlay');
create type camera_type as enum ('static','ken_burns_in','ken_burns_out','pan_l','pan_r','tilt_up','tilt_down','push_in','pull_out','parallax');
create type transition_type as enum ('cut','crossfade','fade_in','fade_out','slide','dip_to_black');
create type clue_type as enum ('physical','testimony','motive','alibi','contradiction','other');
create type clue_status as enum ('introduced','recalled','resolved','red_herring');
create type review_kind as enum ('bible','casting','chapter_script','assets','storyboard','final');
create type review_status as enum ('open','approved','rejected','skipped');
create type render_scope as enum ('preview','master','episode');
create type render_status as enum ('queued','running','succeeded','failed','cancelled');
create type job_status as enum ('pending','running','succeeded','failed','cancelled');
create type take_status as enum ('draft','accepted','rejected');
```

## 4. 核心表

### 4.1 books（项目 = 一本书）

```sql
create table books (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  title text not null,
  source_file_key text,            -- R2 原始 txt
  source_file_name text,
  language text not null default 'zh',
  total_chars int not null default 0,
  status project_status not null default 'draft',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- settings 示例：
-- {
--   "aspect_ratio": "16:9", "resolution": "1920x1080", "fps": 25,
--   "target_total_duration_sec": 3600, "episode_max_sec": 1200,
--   "subtitle_mode": "burned",           -- burned | soft | none
--   "budget_usd_cap": 15,                -- 单本书 AI 成本上限
--   "mode": "nightly"                    -- nightly | on_demand
-- }
```

### 4.2 source_chapters（清洗后的原文章节）

```sql
create table source_chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  idx int not null,
  title text,
  raw_text text not null,          -- 清洗前的原文（留证）
  cleaned_text text not null,      -- 规范化后的正文
  char_count int not null default 0,
  status artifact_status not null default 'draft',
  parse_meta jsonb not null default '{}'::jsonb,  -- 标题行号、清洗动作记录
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, idx)
);
```

### 4.3 chapter_summaries（章节摘要 + 检索向量）

```sql
create extension if not exists vector;
create extension if not exists pg_trgm;

create table chapter_summaries (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  source_chapter_id uuid not null unique references source_chapters(id) on delete cascade,
  summary text not null,
  key_events jsonb not null default '[]'::jsonb,   -- [{time, desc, character_ids}]
  new_facts jsonb not null default '[]'::jsonb,    -- 本章新增事实
  characters jsonb not null default '[]'::jsonb,   -- 本章在场人物快照
  clues jsonb not null default '[]'::jsonb,        -- 本章涉及线索
  tone text,                                       -- 悬疑/日常/高潮...
  embedding vector(1536),                          -- 段落检索（模型维度变化时重建）
  created_at timestamptz not null default now()
);

create index on chapter_summaries using hnsw (embedding vector_cosine_ops);
```

### 4.4 characters / character_relations

```sql
create table characters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  canonical_name text not null,
  aliases text[] not null default '{}',
  role text not null default 'other',     -- protagonist/detective/suspect/victim/witness/other
  archetype text,
  description text,
  bio jsonb not null default '{}'::jsonb, -- {appearance, age, occupation, personality, outfit}
  first_chapter_id uuid references source_chapters(id),
  last_chapter_id uuid references source_chapters(id),
  ref_asset_id uuid,                       -- references assets(id)，建表后补 FK
  voice_profile_id uuid,                   -- references voice_profiles(id)
  status artifact_status not null default 'draft',
  spoiler_note text,                       -- “凶手特征勿入画面”之类
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on characters (book_id);
create index on characters using gin (aliases);

create table character_relations (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  source_character_id uuid not null references characters(id) on delete cascade,
  target_character_id uuid not null references characters(id) on delete cascade,
  relation_type text not null,          -- family/romance/enemy/ally/colleague/other
  description text,
  is_spoiler boolean not null default false,
  source_chapter_id uuid references source_chapters(id),
  status artifact_status not null default 'draft',
  created_at timestamptz not null default now(),
  unique (book_id, source_character_id, target_character_id, relation_type)
);
```

### 4.5 locations / items / timeline_events / clues

```sql
create table locations (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  description text,
  visual_note text,                     -- 画面描述：年代/陈设/光影
  first_chapter_id uuid references source_chapters(id),
  ref_asset_id uuid,
  status artifact_status not null default 'draft',
  created_at timestamptz not null default now()
);

create table items (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  name text not null,
  kind text not null default 'object',  -- prop/evidence/weapon/document/object
  description text,
  visual_note text,
  owner_character_id uuid references characters(id),
  first_chapter_id uuid references source_chapters(id),
  ref_asset_id uuid,
  status artifact_status not null default 'draft',
  created_at timestamptz not null default now()
);

create table timeline_events (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  source_chapter_id uuid references source_chapters(id),
  time_label text not null,             -- “案发前三天 夜”
  order_key text not null,              -- '0001'，跨章排序
  description text not null,
  character_ids uuid[] not null default '{}',
  location_id uuid references locations(id),
  confidence float not null default 1.0,
  created_at timestamptz not null default now()
);

create table clues (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  name text not null,
  clue_type clue_type not null default 'other',
  description text not null,
  introduced_chapter_id uuid references source_chapters(id),
  resolved_chapter_id uuid references source_chapters(id),  -- null = 未回收
  is_red_herring boolean not null default false,
  is_spoiler boolean not null default false,   -- 该线索本身剧透（画面禁用）
  status clue_status not null default 'introduced',
  related_character_ids uuid[] not null default '{}',
  related_item_ids uuid[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 4.6 style_bibles / voice_profiles

```sql
create table style_bibles (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null unique references books(id) on delete cascade,
  version int not null default 1,
  status artifact_status not null default 'draft',
  genre text[] not null default '{}',
  visual_style text not null,           -- 一句话画面风格
  art_direction text,                   -- 长篇美术指导
  color_palette jsonb not null default '[]'::jsonb,
  camera_grammar jsonb not null default '{}'::jsonb,  -- 镜头语法参数
  narration_person text,                -- first / third_limited / omniscient
  narration_tone text,
  spoiler_rules jsonb not null default '{}'::jsonb,   -- 剧透控制规则
  negative_prompt jsonb not null default '{}'::jsonb,
  proposal_json jsonb not null default '[]'::jsonb,   -- AI 给的 3 套候选原文
  approved_proposal_index int,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table voice_profiles (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  name text not null,                   -- 显示名：旁白·低沉 / 福尔摩斯
  role voice_role not null default 'character',
  character_id uuid references characters(id),
  provider text not null,
  provider_voice_id text not null,      -- 跨章节锁定的 voice id
  language text not null default 'zh',
  gender text,
  timbre text,
  defaults jsonb not null default '{}'::jsonb,  -- {speed, pitch, volume}
  emotion_range jsonb not null default '[]'::jsonb,
  sample_asset_id uuid,                 -- references assets(id)
  status artifact_status not null default 'draft',
  note text,
  created_at timestamptz not null default now()
);
```

### 4.7 asset_requests / assets（资产库 + 生成留痕）

```sql
create table asset_requests (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  kind asset_kind not null,
  spec jsonb not null,                  -- 完整生成规格（prompt/参考图/参数）
  provider text not null,
  model text not null,
  count int not null default 3,
  aspect_ratio text not null default '16:9',
  status job_status not null default 'pending',
  error jsonb,
  cost_cents int not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table assets (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  kind asset_kind not null,
  title text,
  -- 生成留痕
  provider text,
  model text,
  prompt text,
  negative_prompt text,
  seed bigint,
  params jsonb not null default '{}'::jsonb,
  ref_asset_ids uuid[] not null default '{}',   -- 引用的参考图
  generation_request_id uuid references asset_requests(id),
  -- 语义挂载
  character_id uuid references characters(id),
  location_id uuid references locations(id),
  item_id uuid references items(id),
  expression text,                      -- 表情标签：suspicious/shocked/neutral...
  pose text,                            -- 姿势标签：standing/pointing...
  scene_key text,                       -- 复用键：bg:study_night / char:holmes:angry
  -- 文件与质量
  file_key text,                        -- R2 原图/音频
  thumb_key text,
  mime_type text,
  width int,
  height int,
  duration_ms int,
  file_size_bytes bigint,
  source asset_source not null default 'generated',
  status asset_status not null default 'generating',
  is_candidate boolean not null default true,
  consistency_score float,              -- 与 ref 的相似度/风格分
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on assets (book_id, scene_key);
create index on assets (character_id, expression, pose);
```

### 4.8 adapted_chapters / beats（改编脚本）

```sql
create table adapted_chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  source_chapter_id uuid not null unique references source_chapters(id) on delete cascade,
  idx int not null,
  title text,
  hook text,                            -- 开场 5 秒钩子
  status artifact_status not null default 'draft',
  model text,                           -- 生成用的模型 + 版本
  model_version text,
  target_duration_sec numeric not null default 0,
  estimated_duration_sec numeric not null default 0,
  importance numeric not null default 1.0,   -- 全局时长分配的权重
  selection_report jsonb not null default '{}'::jsonb,  -- 取舍报告
  raw_output jsonb not null default '{}'::jsonb,        -- AI 原始输出
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, idx)
);

create table beats (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  adapted_chapter_id uuid not null references adapted_chapters(id) on delete cascade,
  idx int not null,
  type beat_type not null,
  speaker_type speaker_type not null default 'narrator',
  character_id uuid references characters(id),
  text text not null,                   -- 旁白稿/台词/字幕文本
  emotion text not null default 'neutral',
  pace numeric not null default 1.0,    -- 0.8 慢 ~ 1.3 快
  visual_note text,                     -- 画面内容：人物/动作/背景/情绪
  source_span jsonb not null,           -- {chapter_id, start_char, end_char, quote}
  importance smallint not null default 3,   -- 1~5，5 不可删
  clue_ids uuid[] not null default '{}',
  flags jsonb not null default '{}'::jsonb, -- {spoiler:true, low_confidence:true}
  estimated_duration_sec numeric not null default 0,
  status artifact_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (adapted_chapter_id, idx)
);
```

### 4.9 shots / shot_layers（分层分镜）

```sql
create table shots (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  beat_id uuid not null references beats(id) on delete cascade,
  idx int not null,
  description text,
  camera camera_type not null default 'static',
  duration_sec numeric not null,
  transition_in transition_type not null default 'cut',
  transition_out transition_type not null default 'cut',
  background_asset_id uuid references assets(id),
  style jsonb not null default '{}'::jsonb,   -- {zoom, filter, overlay...}
  status artifact_status not null default 'draft',
  created_at timestamptz not null default now(),
  unique (beat_id, idx)
);

create table shot_layers (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid not null references shots(id) on delete cascade,
  idx int not null,
  z smallint not null default 0,
  kind layer_kind not null default 'character',
  character_id uuid references characters(id),
  asset_id uuid not null references assets(id),
  expression text,
  pose text,
  rect jsonb not null default '{"x":0.5,"y":0.5,"w":0.4,"h":0.6}'::jsonb,  -- 归一化坐标
  enter_animation text,                 -- fade_in / slide_left / none
  exit_animation text,
  motion jsonb not null default '{}'::jsonb,  -- {drift, parallax, loop}
  opacity numeric not null default 1,
  locked boolean not null default false,      -- 人工锁定的调整不被重跑覆盖
  created_at timestamptz not null default now(),
  unique (shot_id, idx)
);
```

### 4.10 voice_takes（逐句配音）

```sql
create table voice_takes (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  beat_id uuid not null references beats(id) on delete cascade,
  voice_profile_id uuid not null references voice_profiles(id),
  provider text not null,
  model text,
  params jsonb not null default '{}'::jsonb,  -- emotion/speed/emphasis
  audio_asset_id uuid references assets(id),
  duration_ms int,
  asr_text text,                        -- ASR 回读结果
  asr_confidence float,                 -- 与台词相似度
  status take_status not null default 'draft',
  error jsonb,
  created_at timestamptz not null default now()
);
```

### 4.11 timelines / episodes / render_jobs

```sql
create table timelines (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  kind text not null,                   -- master / episode / preview
  version int not null default 1,
  duration_sec numeric,
  snapshot jsonb not null,              -- 渲染唯一事实来源（分层镜头+音轨+字幕）
  status artifact_status not null default 'draft',
  created_at timestamptz not null default now()
);

create table episodes (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  idx int not null,
  title text,
  description text,
  start_time_sec numeric,               -- master 中的起点
  end_time_sec numeric,
  cover_asset_id uuid references assets(id),
  timeline_id uuid references timelines(id),
  render_job_id uuid,                   -- references render_jobs(id)
  status artifact_status not null default 'draft',
  publish_meta jsonb not null default '{}'::jsonb,  -- 标题候选/简介/标签/平台规格
  created_at timestamptz not null default now(),
  unique (book_id, idx)
);

create table render_jobs (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  scope render_scope not null default 'preview',
  episode_id uuid references episodes(id),
  timeline_id uuid references timelines(id),
  preset jsonb not null default '{}'::jsonb,      -- 分辨率/码率/字幕模式/响度
  status render_status not null default 'queued',
  progress numeric not null default 0,
  output_file_key text,
  thumb_key text,
  duration_sec numeric,
  log text,
  error jsonb,
  cost_cents int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
```

### 4.12 jobs / review_tasks / chapter_contexts（编排与留痕）

```sql
create table jobs (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  node text not null,                   -- 流水线节点 id，如 'adapt.chapter'
  parent_id uuid references jobs(id),
  input_ref jsonb not null default '{}'::jsonb,   -- 输入引用（id 集合）
  output_ref jsonb not null default '{}'::jsonb,  -- 输出引用
  status job_status not null default 'pending',
  attempt int not null default 0,
  max_attempts int not null default 3,
  error jsonb,
  cost jsonb not null default '{}'::jsonb,        -- {input_tokens, output_tokens, usd, duration_ms}
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table review_tasks (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  kind review_kind not null,
  target_type text not null,            -- 表名：style_bibles / adapted_chapters / assets ...
  target_id uuid not null,
  status review_status not null default 'open',
  ai_report jsonb not null default '{}'::jsonb,   -- AI 自检报告（红/黄/绿项）
  human_decision jsonb,                 -- {decision, note, by, at}
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table chapter_contexts (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  adapted_chapter_id uuid not null unique references adapted_chapters(id) on delete cascade,
  input_snapshot jsonb not null,        -- 生成时喂给模型的完整输入（可回放）
  input_tokens int,
  output_tokens int,
  cost_cents int not null default 0,
  model text,
  created_at timestamptz not null default now()
);
```

## 5. 状态机

### 5.1 统一产物状态

```
draft ──→ pending_review ──→ approved ──→ (被上游变更) stale ──→ 重新生成 → pending_review
             │
             └──→ rejected ──→ draft
```

### 5.2 资产状态

```
generating ──→ candidate ──→ approved ──→ archived（被替换，不删除）
                  │
                  └──→ rejected
```

### 5.3 渲染状态

```
queued ──→ running ──→ succeeded
   ↑          │
   └── 重试 ──┴──→ failed ──→（人工检查日志）queued / cancelled
```

### 5.4 各表实际使用到的字段

| 表 | 用 artifact_status | 备注 |
|---|---|---|
| source_chapters | 是 | draft→pending_review→approved（清洗审核） |
| characters/locations/items | 是 | 实体档案审核 |
| style_bibles/voice_profiles | 是 | 签核点 A |
| adapted_chapters/beats/shots | 是 | 签核点 B（脚本）、D（分镜） |
| assets | 用 asset_status | 签核点 C |
| timelines | 是 | 快照批准 |
| episodes | 是 | 最终发布批准 |

## 6. stale 传播规则（v0 先做这些）

| 上游变更 | 下游动作 |
|---|---|
| style_bible 重新批准 | 全部 `adapted_chapters` → stale；用旧 style 生成的 assets → 提示重做（默认仅新章节生效，用户可选全量） |
| voice_profile 变更 | 该 voice 的所有 `voice_takes` → 重做；`render_jobs` 重渲染 |
| source_chapter 文本编辑 | 该章 adapted_chapter → stale；后续章节的 `chapter_summaries` / contexts → stale |
| character 档案/参考图变更 | 该角色的 expression/pose assets → stale（背景不受影响） |
| 已批准 asset 被替换 | 只更新 shot_layers.asset_id，重渲染；不重跑 AI |
| 人工调整 shot（locked=true） | 重跑 storyboard 时保留锁定图层 |

实现方式：每条 stale 更新同时写 `updated_at`，并往 `jobs` 挂一条“待重跑”任务；**重跑永远是显式触发**（夜跑或按钮），不自动烧钱。

## 7. 一个 shot 的完整 JSON 示例

```json
{
  "beat": {
    "id": "b1", "type": "dialogue", "speaker_type": "character",
    "character_id": "c_holmes", "emotion": "suspicious", "pace": 1.0,
    "text": "这扇窗是从里面反锁的。",
    "visual_note": "福尔摩斯站在窗边，怀疑地看向窗闩",
    "source_span": {"chapter_id": "ch3", "start_char": 1200, "end_char": 1288, "quote": "……"},
    "clue_ids": ["clue_locked_window"],
    "estimated_duration_sec": 4.2
  },
  "shot": {
    "background_asset_id": "a_bg_study_night",
    "camera": "push_in", "duration_sec": 4.2,
    "transition_in": "cut", "transition_out": "crossfade",
    "layers": [
      {
        "kind": "character", "character_id": "c_holmes",
        "asset_id": "a_holmes_suspicious",
        "expression": "suspicious", "pose": "standing",
        "rect": {"x": 0.55, "y": 0.30, "w": 0.36, "h": 0.62},
        "enter_animation": "none", "exit_animation": "none",
        "motion": {"type": "breath", "amplitude": 0.002}
      },
      {
        "kind": "prop", "item_id": "i_window_latch",
        "asset_id": "a_prop_window_latch",
        "rect": {"x": 0.72, "y": 0.25, "w": 0.10, "h": 0.08},
        "enter_animation": "fade_in", "exit_animation": "none",
        "motion": {"type": "zoom", "from": 1.0, "to": 1.15}
      }
    ]
  }
}
```

## 8. 索引与扩展建议

- `characters.aliases`、`locations.aliases` 用 GIN + pg_trgm，实体合并靠它。
- `chapter_summaries.embedding` 用 HNSW；换 embedding 模型时整列重建，version 记在 book.settings。
- 所有表启用 RLS：`books` 上 `owner_id = auth.uid()`，子表用 `book_id` 间接策略。
- 大字段（raw_text / cleaned_text / snapshot / raw_output）必要时拆到 R2 + 指针，v0 先留在 PG，30 万字级完全没问题。
