-- =============================================================
-- novel-cinema · schema v0 (M0 全量建表)
-- 对应 docs/01-data-model-v0.md
-- 目标环境：Supabase Postgres（pgvector / pgcrypto 已内置）
-- 注意：RLS 策略依赖 auth.users（Supabase 环境）；纯本地 PG 测试
--       请先去掉 books.owner_id 的 FK 与 DO 块中的 auth.uid()。
-- =============================================================

create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------
-- 枚举
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- 核心表（注意循环 FK 在末尾统一补）
-- ---------------------------------------------------------------

create table books (
  id uuid primary key default gen_random_uuid(),
  -- M0 单人自用阶段不接 auth：先不挂 FK，由 service_role 写入。
  -- 接入登录后补：references auth.users(id)
  owner_id uuid not null,
  title text not null,
  source_file_key text,
  source_file_name text,
  language text not null default 'zh',
  total_chars int not null default 0,
  status project_status not null default 'draft',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table source_chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  idx int not null,
  title text,
  raw_text text not null,
  cleaned_text text not null,
  char_count int not null default 0,
  status artifact_status not null default 'draft',
  parse_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, idx)
);

create table chapter_summaries (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  source_chapter_id uuid not null unique references source_chapters(id) on delete cascade,
  summary text not null,
  key_events jsonb not null default '[]'::jsonb,
  new_facts jsonb not null default '[]'::jsonb,
  characters jsonb not null default '[]'::jsonb,
  clues jsonb not null default '[]'::jsonb,
  tone text,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index on chapter_summaries using hnsw (embedding vector_cosine_ops);

create table characters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  canonical_name text not null,
  aliases text[] not null default '{}',
  role text not null default 'other',
  archetype text,
  description text,
  bio jsonb not null default '{}'::jsonb,
  first_chapter_id uuid references source_chapters(id),
  last_chapter_id uuid references source_chapters(id),
  ref_asset_id uuid,               -- FK 补在 assets 表创建之后
  voice_profile_id uuid,            -- FK 补在 voice_profiles 表创建之后
  status artifact_status not null default 'draft',
  spoiler_note text,
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
  relation_type text not null,
  description text,
  is_spoiler boolean not null default false,
  source_chapter_id uuid references source_chapters(id),
  status artifact_status not null default 'draft',
  created_at timestamptz not null default now(),
  unique (book_id, source_character_id, target_character_id, relation_type)
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  description text,
  visual_note text,
  first_chapter_id uuid references source_chapters(id),
  ref_asset_id uuid,
  status artifact_status not null default 'draft',
  created_at timestamptz not null default now()
);

create index on locations (book_id);

create table items (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  name text not null,
  kind text not null default 'object',
  description text,
  visual_note text,
  owner_character_id uuid references characters(id),
  first_chapter_id uuid references source_chapters(id),
  ref_asset_id uuid,
  status artifact_status not null default 'draft',
  created_at timestamptz not null default now()
);

create index on items (book_id);

create table timeline_events (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  source_chapter_id uuid references source_chapters(id),
  time_label text not null,
  order_key text not null,
  description text not null,
  character_ids uuid[] not null default '{}',
  location_id uuid references locations(id),
  confidence float not null default 1.0,
  created_at timestamptz not null default now()
);

create index on timeline_events (book_id, order_key);

create table clues (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  name text not null,
  clue_type clue_type not null default 'other',
  description text not null,
  introduced_chapter_id uuid references source_chapters(id),
  resolved_chapter_id uuid references source_chapters(id),
  is_red_herring boolean not null default false,
  is_spoiler boolean not null default false,
  status clue_status not null default 'introduced',
  related_character_ids uuid[] not null default '{}',
  related_item_ids uuid[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on clues (book_id);

create table style_bibles (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null unique references books(id) on delete cascade,
  version int not null default 1,
  status artifact_status not null default 'draft',
  genre text[] not null default '{}',
  visual_style text not null,
  art_direction text,
  color_palette jsonb not null default '[]'::jsonb,
  camera_grammar jsonb not null default '{}'::jsonb,
  narration_person text,
  narration_tone text,
  spoiler_rules jsonb not null default '{}'::jsonb,
  negative_prompt jsonb not null default '{}'::jsonb,
  proposal_json jsonb not null default '[]'::jsonb,
  approved_proposal_index int,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table voice_profiles (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  name text not null,
  role voice_role not null default 'character',
  character_id uuid references characters(id),
  provider text not null,
  provider_voice_id text not null,
  language text not null default 'zh',
  gender text,
  timbre text,
  defaults jsonb not null default '{}'::jsonb,
  emotion_range jsonb not null default '[]'::jsonb,
  sample_asset_id uuid,
  status artifact_status not null default 'draft',
  note text,
  created_at timestamptz not null default now()
);

create index on voice_profiles (book_id);

create table asset_requests (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  kind asset_kind not null,
  spec jsonb not null,
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

create index on asset_requests (book_id, status);

create table assets (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  kind asset_kind not null,
  title text,
  provider text,
  model text,
  prompt text,
  negative_prompt text,
  seed bigint,
  params jsonb not null default '{}'::jsonb,
  ref_asset_ids uuid[] not null default '{}',
  generation_request_id uuid references asset_requests(id),
  character_id uuid references characters(id),
  location_id uuid references locations(id),
  item_id uuid references items(id),
  expression text,
  pose text,
  scene_key text,
  file_key text,
  thumb_key text,
  mime_type text,
  width int,
  height int,
  duration_ms int,
  file_size_bytes bigint,
  source asset_source not null default 'generated',
  status asset_status not null default 'generating',
  is_candidate boolean not null default true,
  consistency_score float,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on assets (book_id, scene_key);
create index on assets (character_id, expression, pose);

-- 循环 FK 补齐（characters <-> assets / voice_profiles）
alter table characters
  add constraint characters_ref_asset_fk
  foreign key (ref_asset_id) references assets(id) on delete set null;
alter table characters
  add constraint characters_voice_profile_fk
  foreign key (voice_profile_id) references voice_profiles(id) on delete set null;
alter table voice_profiles
  add constraint voice_profiles_character_fk
  foreign key (character_id) references characters(id) on delete set null;
alter table voice_profiles
  add constraint voice_profiles_sample_asset_fk
  foreign key (sample_asset_id) references assets(id) on delete set null;

create table adapted_chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  source_chapter_id uuid not null unique references source_chapters(id) on delete cascade,
  idx int not null,
  title text,
  hook text,
  status artifact_status not null default 'draft',
  model text,
  model_version text,
  target_duration_sec numeric not null default 0,
  estimated_duration_sec numeric not null default 0,
  importance numeric not null default 1.0,
  selection_report jsonb not null default '{}'::jsonb,
  raw_output jsonb not null default '{}'::jsonb,
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
  text text not null,
  emotion text not null default 'neutral',
  pace numeric not null default 1.0,
  visual_note text,
  source_span jsonb not null,
  importance smallint not null default 3,
  clue_ids uuid[] not null default '{}',
  flags jsonb not null default '{}'::jsonb,
  estimated_duration_sec numeric not null default 0,
  status artifact_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (adapted_chapter_id, idx)
);

create index on beats (book_id, adapted_chapter_id, idx);

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
  style jsonb not null default '{}'::jsonb,
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
  -- text/overlay 层无图片资产，允许为空
  asset_id uuid references assets(id),
  expression text,
  pose text,
  rect jsonb not null default '{"x":0.5,"y":0.5,"w":0.4,"h":0.6}'::jsonb,
  enter_animation text,
  exit_animation text,
  motion jsonb not null default '{}'::jsonb,
  opacity numeric not null default 1,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (shot_id, idx)
);

create table voice_takes (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  beat_id uuid not null references beats(id) on delete cascade,
  voice_profile_id uuid not null references voice_profiles(id),
  provider text not null,
  model text,
  params jsonb not null default '{}'::jsonb,
  audio_asset_id uuid references assets(id),
  duration_ms int,
  asr_text text,
  asr_confidence float,
  status take_status not null default 'draft',
  error jsonb,
  created_at timestamptz not null default now()
);

create index on voice_takes (beat_id);

create table timelines (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  kind text not null,
  version int not null default 1,
  duration_sec numeric,
  snapshot jsonb not null,
  status artifact_status not null default 'draft',
  created_at timestamptz not null default now()
);

create index on timelines (book_id, kind, version);

create table render_jobs (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  scope render_scope not null default 'preview',
  episode_id uuid,                 -- FK 补在 episodes 表创建之后
  timeline_id uuid references timelines(id),
  preset jsonb not null default '{}'::jsonb,
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

create table episodes (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  idx int not null,
  title text,
  description text,
  start_time_sec numeric,
  end_time_sec numeric,
  cover_asset_id uuid references assets(id),
  timeline_id uuid references timelines(id),
  render_job_id uuid,              -- FK 补在下面
  status artifact_status not null default 'draft',
  publish_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (book_id, idx)
);

alter table render_jobs
  add constraint render_jobs_episode_fk
  foreign key (episode_id) references episodes(id) on delete set null;
alter table episodes
  add constraint episodes_render_job_fk
  foreign key (render_job_id) references render_jobs(id) on delete set null;

create table jobs (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  node text not null,
  parent_id uuid references jobs(id),
  input_ref jsonb not null default '{}'::jsonb,
  output_ref jsonb not null default '{}'::jsonb,
  status job_status not null default 'pending',
  attempt int not null default 0,
  max_attempts int not null default 3,
  error jsonb,
  cost jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index on jobs (book_id, node, status);

create table review_tasks (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  kind review_kind not null,
  target_type text not null,
  target_id uuid not null,
  status review_status not null default 'open',
  ai_report jsonb not null default '{}'::jsonb,
  human_decision jsonb,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index on review_tasks (book_id, status);

create table chapter_contexts (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  adapted_chapter_id uuid not null unique references adapted_chapters(id) on delete cascade,
  input_snapshot jsonb not null,
  input_tokens int,
  output_tokens int,
  cost_cents int not null default 0,
  model text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- RLS：单租户隔离。books 按 owner_id，其余表按 book_id 归属。
-- 服务角色（service_role）自动绕过 RLS，无需额外授权。
-- ---------------------------------------------------------------

alter table books enable row level security;
create policy books_owner_scope on books for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'source_chapters','chapter_summaries','characters','character_relations',
    'locations','items','timeline_events','clues','style_bibles','voice_profiles',
    'asset_requests','assets','adapted_chapters','beats','shots','shot_layers',
    'voice_takes','timelines','render_jobs','episodes','jobs','review_tasks',
    'chapter_contexts'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy book_scope on %I for all ' ||
      'using (book_id in (select id from books where owner_id = auth.uid())) ' ||
      'with check (book_id in (select id from books where owner_id = auth.uid()))', t);
  end loop;
end $$;
