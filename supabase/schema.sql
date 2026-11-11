-- =====================================================================================
-- 个人错题本 MistakeBook · Supabase 数据库初始化脚本
-- 执行位置：Supabase Dashboard → 左侧 SQL Editor → New query → 粘贴全文 → Run
-- 特性：可重复执行（幂等）；16 张业务表；全表 RLS；Storage 私有桶；自动版本快照
-- 版本：v1.0
-- =====================================================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------------------------
-- 0. 通用函数
-- -------------------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- 新用户注册后自动初始化：资料 / 设置 / 默认科目 / 默认错题本
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email,'user'), '@', 1)))
  on conflict (id) do nothing;

  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  insert into public.subjects (user_id, name, color, sort_order) values
    (new.id, '数学', '#ef4444', 1),
    (new.id, '物理', '#3b82f6', 2),
    (new.id, '英语', '#10b981', 3),
    (new.id, '化学', '#f59e0b', 4),
    (new.id, '其他', '#64748b', 99)
  on conflict do nothing;

  insert into public.mistake_books (user_id, name, description) values
    (new.id, '默认错题本', '系统自动创建，可在设置中改名或新建更多错题本')
  on conflict do nothing;

  return new;
end $$;

-- 每次更新错题正文类字段，自动把「修改前」内容存成历史版本（支持 AI 整理后回滚）
create or replace function public.capture_mistake_version()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_next int;
begin
  if (new.title, new.content, new.answer, new.analysis, new.knowledge_points, new.cause, new.difficulty, new.source)
     is distinct from
     (old.title, old.content, old.answer, old.analysis, old.knowledge_points, old.cause, old.difficulty, old.source)
  then
    select coalesce(max(version_no), 0) + 1 into v_next
      from public.mistake_versions where mistake_id = old.id;
    insert into public.mistake_versions (user_id, mistake_id, version_no, snapshot, change_note)
    values (old.user_id, old.id, v_next, to_jsonb(old), '自动保存（修改前快照）');
  end if;
  return new;
end $$;

-- 清空当前用户回收站中超过 30 天的错题（由前端「清空」或定时任务调用）
create or replace function public.purge_expired_trash()
returns integer language plpgsql security definer set search_path = public as $$
declare v_cnt int;
begin
  with d as (
    delete from public.mistakes
     where user_id = auth.uid() and deleted_at is not null
       and deleted_at < now() - interval '30 days'
    returning id
  ) select count(*) into v_cnt from d;
  return v_cnt;
end $$;

-- 注销账号数据：清空当前用户所有业务数据（不可恢复，前端必须二次确认）
create or replace function public.delete_my_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.mistakes where user_id = auth.uid();       -- 级联子表
  delete from public.subjects where user_id = auth.uid();
  delete from public.mistake_books where user_id = auth.uid();
  delete from public.tags where user_id = auth.uid();
  delete from public.print_templates where user_id = auth.uid();
  delete from public.share_links where user_id = auth.uid();
  delete from public.ai_usage_logs where user_id = auth.uid();
  delete from public.user_settings where user_id = auth.uid();
  delete from public.profiles where user_id = auth.uid();
end $$;

-- -------------------------------------------------------------------------------------
-- 1. 建表
-- -------------------------------------------------------------------------------------

-- 1.1 用户资料
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '同学',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1.2 用户设置 ★ AI 总开关 / 子开关就在这里，跨设备同步
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ai_enabled boolean not null default false,       -- 总开关，默认关闭 = 零 AI 费用
  ai_organize boolean not null default true,       -- 子开关：AI 整理错题
  ai_ocr boolean not null default true,            -- 子开关：OCR / 图片识题
  ai_similar boolean not null default true,        -- 子开关：相似题推荐
  ai_batch boolean not null default true,          -- 子开关：AI 批量整理
  ai_text_model text not null default 'qwen3.7-plus',
  ai_vision_model text not null default 'qwen3.7-plus',
  default_print_template_id uuid,
  review_intervals jsonb not null default '[1,2,4,7,15,30]'::jsonb,
  prompt_template text not null default '你是一位严谨的学科老师。请把下面这道错题整理成结构化 JSON，字段：normalizedStem(string)、knowledgePoints(string[])、cause(string，取值仅限：计算错误/概念不清/审题错误/公式记错/步骤遗漏/粗心/其他)、steps(string[])、answerPoints(string[])、tags(string[])、difficulty(1-5整数)、reviewAdvice(string)、similarQuestions(string[])。只输出 JSON，不要解释。',
  backup_reminder_days int not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1.3 科目
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#6366f1',
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

-- 1.4 错题本
create table if not exists public.mistake_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  name text not null,
  description text not null default '',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

-- 1.5 标签
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#8b5cf6',
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- 1.6 错题主表
create table if not exists public.mistakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid references public.mistake_books(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete set null,
  title text not null default '未命名错题',
  content text not null default '',                 -- Tiptap HTML
  answer text not null default '',
  analysis text not null default '',
  knowledge_points text[] not null default '{}',
  cause text not null default '其他' check (cause in ('计算错误','概念不清','审题错误','公式记错','步骤遗漏','粗心','其他')),
  difficulty smallint not null default 3 check (difficulty between 1 and 5),
  source text not null default '',
  mastery text not null default 'unmastered' check (mastery in ('unmastered','fuzzy','mastered')),
  mistake_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  next_review_at timestamptz not null default now(),
  review_interval_days int not null default 1,
  review_count int not null default 0,
  error_count int not null default 1,
  deleted_at timestamptz,                          -- 软删除 = 进回收站
  ai_result jsonb,
  ai_applied_at timestamptz,
  similar_questions jsonb not null default '[]'::jsonb
);

create index if not exists idx_mistakes_user_date on public.mistakes (user_id, deleted_at, mistake_date desc);
create index if not exists idx_mistakes_user_created on public.mistakes (user_id, deleted_at, created_at desc);
create index if not exists idx_mistakes_review on public.mistakes (user_id, next_review_at) where deleted_at is null;
create index if not exists idx_mistakes_subject on public.mistakes (user_id, subject_id);
create index if not exists idx_mistakes_trash on public.mistakes (user_id, deleted_at) where deleted_at is not null;

-- 1.7 错题图片（只存 Storage 路径，不存公开 URL）
create table if not exists public.mistake_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mistake_id uuid not null references public.mistakes(id) on delete cascade,
  storage_path text not null,
  mime_type text not null default 'image/webp',
  width int,
  height int,
  size_bytes int,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (mistake_id, storage_path)
);

-- 1.8 错题-标签关联
create table if not exists public.mistake_tags (
  mistake_id uuid not null references public.mistakes(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (mistake_id, tag_id)
);

-- 1.9 复习记录
create table if not exists public.review_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mistake_id uuid not null references public.mistakes(id) on delete cascade,
  result text not null check (result in ('again','fuzzy','mastered')),
  note text not null default '',
  reviewed_at timestamptz not null default now(),
  next_review_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_review_logs_user on public.review_logs (user_id, reviewed_at desc);

-- 1.10 重练 / 组卷记录
create table if not exists public.practice_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mistake_id uuid not null references public.mistakes(id) on delete cascade,
  paper_no text,
  result text not null default 'again' check (result in ('again','fuzzy','mastered')),
  note text not null default '',
  answered_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_practice_logs_user on public.practice_logs (user_id, answered_at desc);

-- 1.11 AI 任务（状态 + 结果缓存）
create table if not exists public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mistake_id uuid references public.mistakes(id) on delete cascade,
  kind text not null check (kind in ('organize','ocr','similar','batch')),
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed')),
  input_hash text not null,
  model text,
  result_json jsonb,
  error_code text,
  error text,
  attempts int not null default 0,
  request_tokens int not null default 0,
  response_tokens int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_ai_jobs_cache on public.ai_jobs (user_id, kind, input_hash, status);
create index if not exists idx_ai_jobs_user on public.ai_jobs (user_id, created_at desc);

-- 1.12 AI 调用消耗
create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.ai_jobs(id) on delete set null,
  kind text not null,
  model text,
  request_tokens int not null default 0,
  response_tokens int not null default 0,
  total_tokens int not null default 0,
  quota_units int not null default 1,       -- Coding Plan 按请求次数计，1 次 = 1 单位
  status text not null default 'ok',
  error_code text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_usage_user on public.ai_usage_logs (user_id, created_at desc);

-- 1.13 历史版本
create table if not exists public.mistake_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mistake_id uuid not null references public.mistakes(id) on delete cascade,
  version_no int not null,
  snapshot jsonb not null,
  change_note text not null default '',
  created_at timestamptz not null default now(),
  unique (mistake_id, version_no)
);

-- 1.14 打印模板
create table if not exists public.print_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  variant text not null default 'student' check (variant in ('student','answer','review','cause')),
  options jsonb not null default '{"showAnswer":true,"showAnalysis":true,"showKnowledge":true,"showTags":true,"showImages":true,"showCause":true,"showReviewAdvice":false,"showHeader":true}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

-- 1.15 只读分享链接
create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  scope text not null check (scope in ('single','book','filter')),
  target_id uuid,
  filter_json jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '7 days'),
  revoked boolean not null default false,
  view_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_share_token on public.share_links (token);

-- 1.16 OCR 任务
create table if not exists public.ocr_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mistake_id uuid references public.mistakes(id) on delete cascade,
  image_path text,
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed')),
  model text,
  raw_text text not null default '',
  result_json jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- -------------------------------------------------------------------------------------
-- 2. 触发器
-- -------------------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists trg_capture_mistake_version on public.mistakes;
create trigger trg_capture_mistake_version before update on public.mistakes
  for each row execute function public.capture_mistake_version();

do $$
declare t text;
begin
  foreach t in array array['profiles','user_settings','subjects','mistake_books','mistakes','ai_jobs','print_templates'] loop
    execute format('drop trigger if exists trg_updated_at on public.%I', t);
    execute format('create trigger trg_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- -------------------------------------------------------------------------------------
-- 3. 行级安全 RLS：所有业务表，用户只能增删改查自己的数据
-- -------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','user_settings','subjects','mistake_books','tags','mistakes',
    'mistake_images','mistake_tags','review_logs','practice_logs','ai_jobs',
    'ai_usage_logs','mistake_versions','print_templates','share_links','ocr_jobs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own_rows" on public.%I', t);
    execute format($f$
      create policy "own_rows" on public.%I
        for all to authenticated
        using (auth.uid() = %s)
        with check (auth.uid() = %s)
    $f$, t, case when t = 'profiles' then 'id' else 'user_id' end,
             case when t = 'profiles' then 'id' else 'user_id' end);
  end loop;
end $$;

-- 说明：
--  · profiles 主键列名为 id，其余表统一为 user_id，故上面做了列名分支。
--  · 关联表（mistake_images / mistake_tags / ai_jobs 等）也带 user_id，策略一致，避免漏配。
--  · 未登录(anon) 对上述表没有任何策略 = 完全不可访问；分享页只通过服务端 service_role 白名单读取。
--  · auth.users 本身由 Supabase Auth 管理，禁止直接开放。

-- -------------------------------------------------------------------------------------
-- 4. Storage：私有图片桶 mistake-images
--    路径约定： <auth.uid()>/<mistakeId>/<uuid>.webp   → foldername(name)[1] = 用户 id
-- -------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mistake-images', 'mistake-images', false, 52428800,
  array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "img_select_own" on storage.objects;
create policy "img_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'mistake-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "img_insert_own" on storage.objects;
create policy "img_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'mistake-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "img_update_own" on storage.objects;
create policy "img_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'mistake-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'mistake-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "img_delete_own" on storage.objects;
create policy "img_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'mistake-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- -------------------------------------------------------------------------------------
-- 5. 权限（Supabase 默认已授予，这里显式补齐，避免自建环境遗漏）
-- -------------------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant execute on function public.purge_expired_trash() to authenticated;
grant execute on function public.delete_my_data() to authenticated;

-- -------------------------------------------------------------------------------------
-- 6. 执行完成后的自检（v4 完整版应输出 31 行、全部 rls = true；16 行是 v1 口径）
-- -------------------------------------------------------------------------------------
-- select tablename, rowsecurity as rls from pg_tables
--  where schemaname = 'public' order by tablename;
--
-- 检查桶：
-- select id, public, file_size_limit from storage.buckets where id = 'mistake-images';
--
-- 检查 AI 开关（注册一个账号后）：
-- select user_id, ai_enabled, ai_organize, ai_ocr, ai_similar, ai_batch from public.user_settings;
-- =====================================================================================
-- 阶段 2 完成。下一步：在 supabase 控制台 Authentication → Providers 打开 Email，
-- 并在 URL Configuration 里把 Site URL / Redirect URLs 加上部署域名与 /api/auth/callback。
-- =====================================================================================


-- #################################################################################
-- #################################################################################
-- ##                                                                                 ##
-- ##   PART II · v2 增量：个人综合管理网站（第 7 段）                                ##
-- ##   追加 14 张表 / 扩展 AI 子开关 / 统一回收站 / 全表 RLS                        ##
-- ##   ★ 本文件从最开头一路执行到最末尾，即可一次建好全部 31 张表(v4)             ##
-- ##   ★ 可重复执行（幂等）；已存在 v1 项目直接再跑一次本文件即可升级，不丢数据    ##
-- ##                                                                                 ##
-- #################################################################################
-- #################################################################################

-- -------------------------------------------------------------------------------------
-- II.1 扩展 user_settings：AI 子开关（新增模块）+ 提醒偏好 + 番茄钟配置
-- -------------------------------------------------------------------------------------
alter table public.user_settings
  add column if not exists ai_schedule_parse boolean not null default true,   -- AI 自然语言创建日程
  add column if not exists ai_note_summary   boolean not null default true,   -- AI 笔记总结
  add column if not exists ai_plan           boolean not null default false,  -- AI 规划（预留，默认关）
  add column if not exists reminder_enabled  boolean not null default true,   -- 日程提醒总开关
  add column if not exists default_calendar_view text not null default 'month'
    check (default_calendar_view in ('day','week','month')),
  add column if not exists default_remind_minutes int not null default 15,
  add column if not exists focus_minutes int not null default 25,
  add column if not exists break_minutes int not null default 5;

-- -------------------------------------------------------------------------------------
-- II.2 放宽两个枚举约束（新增 AI 种类 / 新增分享范围）
-- -------------------------------------------------------------------------------------
alter table public.ai_jobs drop constraint if exists ai_jobs_kind_check;
alter table public.ai_jobs add constraint ai_jobs_kind_check
  check (kind in ('organize','ocr','similar','batch','schedule','note','plan'));

alter table public.share_links drop constraint if exists share_links_scope_check;
alter table public.share_links add constraint share_links_scope_check
  check (scope in ('single','book','filter','note','schedule'));

-- -------------------------------------------------------------------------------------
-- II.3 新增表：日程 / 待办 / 笔记 / 习惯 / 番茄钟 / 目标 / 附件 / 统一回收站
-- -------------------------------------------------------------------------------------

-- II.3.1 日程
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '未命名日程',
  description text not null default '',
  start_at timestamptz not null default now(),
  end_at timestamptz,
  all_day boolean not null default false,
  location text not null default '',
  category text not null default '学习' check (category in ('学习','工作','生活','复习','其他')),
  priority smallint not null default 2 check (priority between 1 and 3),   -- 1高 2中 3低
  status text not null default 'todo' check (status in ('todo','done','cancelled')),
  repeat_rule text not null default 'none' check (repeat_rule in ('none','daily','weekly','monthly')),
  remind_minutes int not null default 15,
  -- 模块联动：关联错题 / 笔记 / 待办
  mistake_id uuid references public.mistakes(id) on delete set null,
  note_id uuid,
  task_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_schedules_user_start on public.schedules (user_id, deleted_at, start_at);
create index if not exists idx_schedules_mistake on public.schedules (user_id, mistake_id);

-- II.3.2 日程提醒
create table if not exists public.schedule_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  remind_at timestamptz not null,
  channel text not null default 'inapp' check (channel in ('inapp','email')),
  sent boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_schedule_reminders_user on public.schedule_reminders (user_id, remind_at);

-- II.3.3 待办任务
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '未命名任务',
  description text not null default '',
  priority smallint not null default 2 check (priority between 1 and 3),
  due_at timestamptz,
  completed boolean not null default false,
  completed_at timestamptz,
  repeat_rule text not null default 'none' check (repeat_rule in ('none','daily','weekly','monthly')),
  schedule_id uuid references public.schedules(id) on delete set null,
  mistake_id uuid references public.mistakes(id) on delete set null,
  focus_minutes int not null default 0,      -- 由番茄钟累计
  tags text[] not null default '{}',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tasks_user_due on public.tasks (user_id, deleted_at, due_at);
create index if not exists idx_tasks_mistake on public.tasks (user_id, mistake_id);

-- II.3.4 子任务
create table if not exists public.subtasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- II.3.5 笔记
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '未命名笔记',
  content text not null default '',           -- Tiptap HTML
  tags text[] not null default '{}',
  mistake_id uuid references public.mistakes(id) on delete set null,
  schedule_id uuid references public.schedules(id) on delete set null,
  summary text not null default '',           -- AI 笔记总结（用户确认后才写入）
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_notes_user on public.notes (user_id, deleted_at, updated_at desc);

-- II.3.6 笔记历史版本
create table if not exists public.note_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  version_no int not null,
  snapshot jsonb not null,
  change_note text not null default '',
  created_at timestamptz not null default now(),
  unique (note_id, version_no)
);

-- II.3.7 习惯
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#6366f1',
  icon text not null default 'check',
  target_per_week int not null default 7 check (target_per_week between 1 and 7),
  remind_at time,
  archived boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

-- II.3.8 习惯打卡记录（一天一条）
create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  log_date date not null default current_date,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (habit_id, log_date)
);
create index if not exists idx_habit_logs_user_date on public.habit_logs (user_id, log_date desc);

-- II.3.9 番茄钟专注记录
create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  mistake_id uuid references public.mistakes(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_minutes int not null default 0,
  mode text not null default 'focus' check (mode in ('focus','break')),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_focus_user_started on public.focus_sessions (user_id, started_at desc);

-- II.3.10 目标
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '未命名目标',
  description text not null default '',
  target_date date,
  status text not null default 'active' check (status in ('active','done','paused')),
  progress int not null default 0 check (progress between 0 and 100),
  habit_id uuid references public.habits(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- II.3.11 目标里程碑
create table if not exists public.goal_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  due_date date,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- II.3.12 通用附件（笔记图片等，复用私有桶 mistake-images，路径前缀仍是 <uid>/...）
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('note','schedule','task','goal','habit','mistake')),
  entity_id uuid not null,
  storage_path text not null,
  mime_type text not null default 'image/webp',
  size_bytes int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_attachments_entity on public.attachments (user_id, entity_type, entity_id);

-- II.3.13 统一回收站登记表 ★ 六类实体的软删除都会由触发器自动登记到这里
create table if not exists public.trash_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('mistake','schedule','task','note','habit','goal')),
  entity_id uuid not null,
  title text not null default '',
  deleted_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  unique (entity_type, entity_id)
);
create index if not exists idx_trash_items_user on public.trash_items (user_id, deleted_at desc);

-- -------------------------------------------------------------------------------------
-- II.4 触发器：笔记历史版本 / updated_at / 统一回收站登记
-- -------------------------------------------------------------------------------------
create or replace function public.capture_note_version()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_next int;
begin
  if (new.title, new.content, new.tags, new.summary) is distinct from
     (old.title, old.content, old.tags, old.summary)
  then
    select coalesce(max(version_no), 0) + 1 into v_next
      from public.note_versions where note_id = old.id;
    insert into public.note_versions (user_id, note_id, version_no, snapshot, change_note)
    values (old.user_id, old.id, v_next, to_jsonb(old), '自动保存（修改前快照）');
  end if;
  return new;
end $$;

drop trigger if exists trg_capture_note_version on public.notes;
create trigger trg_capture_note_version before update on public.notes
  for each row execute function public.capture_note_version();

/** 任一主表 deleted_at 变化 → 自动同步 trash_items（前端只需 update deleted_at） */
create or replace function public.sync_trash_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  j jsonb := to_jsonb(new);
  v_type text := TG_ARGV[0];
  v_title_col text := TG_ARGV[1];
  v_id uuid := (j->>'id')::uuid;
  v_title text := coalesce(j->>v_title_col, '(无标题)');
  v_deleted timestamptz := (j->>'deleted_at')::timestamptz;
begin
  if v_deleted is not null then
    insert into public.trash_items (user_id, entity_type, entity_id, title, deleted_at, expires_at)
    values ((j->>'user_id')::uuid, v_type, v_id, left(v_title, 200), v_deleted, v_deleted + interval '30 days')
    on conflict (entity_type, entity_id) do update
      set title = excluded.title, deleted_at = excluded.deleted_at,
          expires_at = excluded.expires_at, user_id = excluded.user_id;
  else
    delete from public.trash_items where entity_type = v_type and entity_id = v_id;
  end if;
  return new;
end $$;

/** 硬删除时同步注销登记表，避免回收站出现「幽灵条目」 */
create or replace function public.remove_trash_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.trash_items
   where entity_type = TG_ARGV[0] and entity_id = old.id;
  return old;
end $$;

-- 六类实体逐一绑定（显式写出，避免动态数组维度差异导致建触发器失败）
drop trigger if exists trg_trash_mistakes on public.mistakes;
create trigger trg_trash_mistakes after insert or update of deleted_at on public.mistakes
  for each row execute function public.sync_trash_item('mistake', 'title');

drop trigger if exists trg_trash_schedules on public.schedules;
create trigger trg_trash_schedules after insert or update of deleted_at on public.schedules
  for each row execute function public.sync_trash_item('schedule', 'title');

drop trigger if exists trg_trash_tasks on public.tasks;
create trigger trg_trash_tasks after insert or update of deleted_at on public.tasks
  for each row execute function public.sync_trash_item('task', 'title');

drop trigger if exists trg_trash_notes on public.notes;
create trigger trg_trash_notes after insert or update of deleted_at on public.notes
  for each row execute function public.sync_trash_item('note', 'title');

drop trigger if exists trg_trash_habits on public.habits;
create trigger trg_trash_habits after insert or update of deleted_at on public.habits
  for each row execute function public.sync_trash_item('habit', 'name');

drop trigger if exists trg_trash_goals on public.goals;
create trigger trg_trash_goals after insert or update of deleted_at on public.goals
  for each row execute function public.sync_trash_item('goal', 'title');

-- 硬删除注销（六张主表）
drop trigger if exists trg_trash_del_mistakes on public.mistakes;
create trigger trg_trash_del_mistakes after delete on public.mistakes
  for each row execute function public.remove_trash_item('mistake');
drop trigger if exists trg_trash_del_schedules on public.schedules;
create trigger trg_trash_del_schedules after delete on public.schedules
  for each row execute function public.remove_trash_item('schedule');
drop trigger if exists trg_trash_del_tasks on public.tasks;
create trigger trg_trash_del_tasks after delete on public.tasks
  for each row execute function public.remove_trash_item('task');
drop trigger if exists trg_trash_del_notes on public.notes;
create trigger trg_trash_del_notes after delete on public.notes
  for each row execute function public.remove_trash_item('note');
drop trigger if exists trg_trash_del_habits on public.habits;
create trigger trg_trash_del_habits after delete on public.habits
  for each row execute function public.remove_trash_item('habit');
drop trigger if exists trg_trash_del_goals on public.goals;
create trigger trg_trash_del_goals after delete on public.goals
  for each row execute function public.remove_trash_item('goal');

do $$
declare t text;
begin
  foreach t in array array['schedules','tasks','notes','habits','goals'] loop
    execute format('drop trigger if exists trg_updated_at on public.%I', t);
    execute format('create trigger trg_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- 旧账号里已经软删除的错题，补登记到统一回收站（幂等）
insert into public.trash_items (user_id, entity_type, entity_id, title, deleted_at, expires_at)
select user_id, 'mistake', id, left(title, 200), deleted_at, deleted_at + interval '30 days'
  from public.mistakes where deleted_at is not null
on conflict (entity_type, entity_id) do nothing;

-- -------------------------------------------------------------------------------------
-- II.5 全表 RLS：新增 14 张表，用户只能增删改查自己的数据
-- -------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'schedules','schedule_reminders','tasks','subtasks','notes','note_versions',
    'habits','habit_logs','focus_sessions','goals','goal_milestones','attachments','trash_items'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own_rows" on public.%I', t);
    execute format($f$
      create policy "own_rows" on public.%I
        for all to authenticated
        using (auth.uid() = user_id)
        with check (auth.uid() = user_id)
    $f$, t);
  end loop;
end $$;

-- -------------------------------------------------------------------------------------
-- II.6 统一回收站函数：列表 / 恢复 / 彻底删除 / 过期清理
--      表名走白名单映射，杜绝 SQL 注入；所有操作再叠加 auth.uid() 过滤
-- -------------------------------------------------------------------------------------
create or replace function public.unified_trash()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.deleted_at desc)
    from (
      select id, entity_type, entity_id, title, deleted_at, expires_at
        from public.trash_items
       where user_id = auth.uid() and expires_at > now()
    ) x
  ), '[]'::jsonb);
end $$;

create or replace function public.restore_trash_item(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_table text;
begin
  v_table := case p_type
    when 'mistake' then 'mistakes' when 'schedule' then 'schedules'
    when 'task' then 'tasks' when 'note' then 'notes'
    when 'habit' then 'habits' when 'goal' then 'goals' end;
  if v_table is null then raise exception '非法实体类型'; end if;
  if auth.uid() is null then raise exception '请先登录'; end if;
  execute format('update public.%I set deleted_at = null where id = $1 and user_id = auth.uid()', v_table) using p_id;
end $$;

create or replace function public.purge_trash_item(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_table text;
begin
  v_table := case p_type
    when 'mistake' then 'mistakes' when 'schedule' then 'schedules'
    when 'task' then 'tasks' when 'note' then 'notes'
    when 'habit' then 'habits' when 'goal' then 'goals' end;
  if v_table is null then raise exception '非法实体类型'; end if;
  if auth.uid() is null then raise exception '请先登录'; end if;
  execute format('delete from public.%I where id = $1 and user_id = auth.uid() and deleted_at is not null', v_table) using p_id;
  delete from public.trash_items where entity_type = p_type and entity_id = p_id and user_id = auth.uid();
end $$;

/** 清空当前用户回收站：删除全部六类超过 30 天的实体（前端「清空」/定时任务调用） */
create or replace function public.purge_expired_trash()
returns integer language plpgsql security definer set search_path = public as $$
declare v_cnt int := 0; v_n int; t text;
begin
  if auth.uid() is null then return 0; end if;
  foreach t in array array['mistakes','schedules','tasks','notes','habits','goals'] loop
    execute format($f$
      delete from public.%I
       where user_id = auth.uid() and deleted_at is not null
         and deleted_at < now() - interval '30 days'
    $f$, t);
    get diagnostics v_n = row_count;
    v_cnt := v_cnt + v_n;
  end loop;
  delete from public.trash_items
   where user_id = auth.uid() and expires_at <= now();
  return v_cnt;
end $$;

/** 注销账号：清空全部业务数据（含新增模块），前端必须二次确认 */
create or replace function public.delete_my_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.mistakes where user_id = auth.uid();       -- 级联错题子表
  delete from public.schedules where user_id = auth.uid();      -- 级联提醒 / 关联
  delete from public.tasks where user_id = auth.uid();          -- 级联子任务
  delete from public.notes where user_id = auth.uid();          -- 级联笔记版本
  delete from public.habits where user_id = auth.uid();         -- 级联打卡
  delete from public.goals where user_id = auth.uid();          -- 级联里程碑
  delete from public.focus_sessions where user_id = auth.uid();
  delete from public.attachments where user_id = auth.uid();
  delete from public.trash_items where user_id = auth.uid();
  delete from public.subjects where user_id = auth.uid();
  delete from public.mistake_books where user_id = auth.uid();
  delete from public.tags where user_id = auth.uid();
  delete from public.print_templates where user_id = auth.uid();
  delete from public.share_links where user_id = auth.uid();
  delete from public.ai_usage_logs where user_id = auth.uid();
  delete from public.ai_jobs where user_id = auth.uid();
  delete from public.ocr_jobs where user_id = auth.uid();
  delete from public.user_settings where user_id = auth.uid();
  delete from public.profiles where user_id = auth.uid();
end $$;

-- -------------------------------------------------------------------------------------
-- II.7 权限补齐
-- -------------------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant execute on function public.unified_trash() to authenticated;
grant execute on function public.restore_trash_item(text, uuid) to authenticated;
grant execute on function public.purge_trash_item(text, uuid) to authenticated;
grant execute on function public.purge_expired_trash() to authenticated;
grant execute on function public.delete_my_data() to authenticated;

-- -------------------------------------------------------------------------------------
-- II.8 升级后自检（应输出 30 行、全部 rls = true）
-- -------------------------------------------------------------------------------------
-- select tablename, rowsecurity as rls from pg_tables
--  where schemaname = 'public' order by tablename;
--
-- 检查新增 AI 子开关列：
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='user_settings' and column_name like 'ai_%' order by 1;
--  期望：ai_batch, ai_enabled, ai_note_summary, ai_ocr, ai_organize, ai_plan,
--        ai_schedule_parse, ai_similar, ai_text_model, ai_vision_model
--
-- 检查统一回收站：
-- select public.unified_trash();   -- 应返回 []（没有已删除数据时）
-- =====================================================================================
-- 阶段 2（v2）完成。下一步：本地配置 .env.local 后 npm run dev，或进入阶段 3 代码整合。
-- =====================================================================================

-- #################################################################################
-- PART III · 补完任务（v3 增量）：历史日期补录的约束与自检
-- 说明：本段不新建表、不改已有列，只是补一条幂等唯一索引并把「重算规则」写进注释，
--       已经执行过 PART I+II 的库，整份重跑一次即可；不会丢数据。
-- #################################################################################

-- III.1 同一天同一习惯只能有一条记录。
-- PART II 建表时已有 unique (habit_id, log_date)；这里再补一条包含 user_id 的唯一索引，
-- 兼容从更早版本迁移过来的库，也让按用户查询走索引。两者不冲突，可重复执行。
create unique index if not exists uq_habit_logs_user_habit_date
  on public.habit_logs (user_id, habit_id, log_date);
create index if not exists idx_habit_logs_habit_date
  on public.habit_logs (habit_id, log_date desc);
comment on table public.habit_logs is
  '习惯打卡：同一用户+习惯+日期唯一（补录不会重复）；前端补录/取消后重新拉取全部记录并重算连续天数（最多回溯730天）、月视图与统计。个人量级一次全量查询，无需分页。';

-- III.2 重算范围与性能影响（前端 lib/data-v2.ts → listHabits）
--  · 重算范围：当前用户「全部」habit_logs（RLS 过滤），不再只查当月，因此补录上个月
--    或任意过去日期都会立即影响 连续天数 / 月视图 / KPI / 目标页与首页的习惯进度；
--  · 连续天数：从今天（今天没打卡则从昨天）往回逐日检查，最多回溯 730 天；
--  · 性能：个人使用通常几百~几千行，一次查询 + 前端 O(N) 计算，毫秒级；
--    若超过 5000 行，可按需在 Supabase 对 habit_logs(user_id, log_date) 建部分索引，
--    或改成按年分段加载；本版本未做分页，属于已知限制。
--  · 取消打卡是硬删除（不进回收站），需要恢复时再补录一次即可。

-- III.3 自检（执行后应看到 2 条索引、unique = true）
-- select indexname, indexdef from pg_indexes
--  where schemaname='public' and tablename='habit_logs' order by indexname;
-- select count(*) as duplicate_days from (
--   select user_id, habit_id, log_date from public.habit_logs
--   group by 1,2,3 having count(*) > 1
-- ) t;   -- 期望 0
-- =====================================================================================
-- PART III 完成。整份 schema.sql 依然是「从头执行一次即可」的幂等脚本。
-- =====================================================================================

-- =====================================================================================
-- PART IV · 图片存储架构 v4（增量 / 幂等 / 可重复执行）
--   架构铁律：数据库只存「路径 + 元数据」，绝不存图片二进制、Base64、Blob。
--   网页 / 列表 / 详情 / 打印 / 分享 / AI OCR 全部通过 Storage URL 取图，不读本地路径。
--   本地电脑只是可选「原图离线备份」，网页任何功能都不依赖它常开。
--   冲突时以本段为准：删除图片先进图片回收站，彻底删除才删 Storage 文件。
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- IV.1 清理历史遗留的二进制 / Base64 字段（幂等；当前项目本来没有，兼容更早的库）
--      只 drop 明确是「图片数据」的列，不碰任何业务字段。
-- -------------------------------------------------------------------------------------
do $$
declare t text; c text;
begin
  foreach t in array array['mistake_images','attachments','ocr_jobs'] loop
    foreach c in array array[
      'base64','data_url','image_data','image_base64','blob_data','content_base64',
      'binary_data','file_data','raw_bytes','data','bytes'
    ] loop
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = t and column_name = c
      ) then
        execute format('alter table public.%I drop column %I', t, c);
      end if;
    end loop;
  end loop;
end $$;

-- -------------------------------------------------------------------------------------
-- IV.2 mistake_images：新增角色 / 备份状态 / 来源 / 压缩元数据 / 草稿绑定
--      ★ mistake_id 改为可空：新建错题页可以先上传整题图（draft_id），保存错题时再绑定。
-- -------------------------------------------------------------------------------------
alter table public.mistake_images alter column mistake_id drop not null;

alter table public.mistake_images
  add column if not exists draft_id uuid,
  add column if not exists image_role text not null default 'inline',
  add column if not exists parent_image_id uuid references public.mistake_images(id) on delete set null,
  add column if not exists crop_rect jsonb,
  add column if not exists original_size_bytes int,
  add column if not exists compressed_size_bytes int,
  add column if not exists thumbnail_path text,
  add column if not exists public_url text,
  add column if not exists is_original_backed_up boolean not null default false,
  add column if not exists original_backup_note text,
  add column if not exists ocr_job_id uuid,
  add column if not exists is_ai_description boolean not null default false,
  add column if not exists created_by text not null default 'user';

-- 约束用 do 块补，重复执行不会重复创建
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_mistake_images_role') then
    alter table public.mistake_images add constraint chk_mistake_images_role
      check (image_role in ('original','cropped','inline','thumbnail'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_mistake_images_bound') then
    alter table public.mistake_images add constraint chk_mistake_images_bound
      check (mistake_id is not null or draft_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_mistake_images_ocr_job') then
    alter table public.mistake_images add constraint fk_mistake_images_ocr_job
      foreign key (ocr_job_id) references public.ocr_jobs(id) on delete set null;
  end if;
end $$;

comment on column public.mistake_images.storage_path is 'Supabase Storage 私有桶内路径；唯一的图片数据来源，不存 URL 之外的任何二进制';
comment on column public.mistake_images.public_url is '可选：仅当 bucket 设为公开时填写完整公开 URL；私有桶保持 NULL，展示时由服务端 createSignedUrls 现签（不落库，避免过期脏数据）';
comment on column public.mistake_images.image_role is 'original=整题原图 / cropped=手动裁剪图 / inline=富文本内嵌图 / thumbnail=前端 canvas 生成的缩略图';
comment on column public.mistake_images.is_original_backed_up is '用户是否已手动下载/导出原图包做本地离线备份；网页功能完全不依赖此字段';
comment on column public.mistake_images.parent_image_id is '裁剪图来源的整图 id；删除整图时据此提示「有裁剪图关联」';
comment on column public.mistake_images.draft_id is '新建错题尚未保存时的临时实体 id；保存错题后由 bindDraftImages 回填 mistake_id';

-- -------------------------------------------------------------------------------------
-- IV.3 attachments：同样补齐角色 / 尺寸 / 压缩元数据 / 备份状态（只存路径与元数据）
-- -------------------------------------------------------------------------------------
alter table public.attachments
  add column if not exists image_role text not null default 'inline',
  add column if not exists parent_image_id uuid,
  add column if not exists crop_rect jsonb,
  add column if not exists width int,
  add column if not exists height int,
  add column if not exists original_size_bytes int,
  add column if not exists compressed_size_bytes int,
  add column if not exists public_url text,
  add column if not exists is_original_backed_up boolean not null default false,
  add column if not exists original_backup_note text;

-- -------------------------------------------------------------------------------------
-- IV.4 ocr_jobs：OCR 结果是「独立记录」，绝不覆盖原图记录
--      新增结构化字段：选项 / 公式 / AI 图形描述 / 置信度 / 应用状态
-- -------------------------------------------------------------------------------------
alter table public.ocr_jobs
  add column if not exists image_id uuid references public.mistake_images(id) on delete set null,
  add column if not exists options text not null default '',
  add column if not exists formulas text not null default '',
  add column if not exists figure_description text,
  add column if not exists is_ai_description boolean not null default false,
  add column if not exists confidence numeric(5,4),
  add column if not exists source text not null default 'ai',
  add column if not exists applied_at timestamptz,
  add column if not exists applied_field text;

comment on column public.ocr_jobs.image_id is '指向整题原图；OCR 文本与本图是两条独立记录，删改题干不影响原图';
comment on column public.ocr_jobs.figure_description is 'AI 图形描述，必须标注「AI 描述，仅供参考」，打印默认不输出';
comment on column public.ocr_jobs.applied_at is '用户点「确认应用」把文字写入题干后才填写，用于审计与防重复';

-- -------------------------------------------------------------------------------------
-- IV.5 图片级回收站：删除图片 / 错题时登记到这里，Storage 文件「不立即物理删除」
--      彻底删除（清空回收站 / 单图彻底删除）时才由客户端调用 storage.remove()
-- -------------------------------------------------------------------------------------
create table if not exists public.deleted_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_table text not null check (source_table in ('mistake_images','attachments')),
  source_id uuid not null,
  mistake_id uuid,
  storage_path text not null,
  image_role text not null default 'inline',
  parent_image_id uuid,
  meta jsonb not null default '{}'::jsonb,
  deleted_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  purged_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_deleted_images_user on public.deleted_images (user_id, purged_at, deleted_at desc);
create unique index if not exists uq_deleted_images_path on public.deleted_images (user_id, storage_path) where purged_at is null;

-- 删除 Storage 失败时留下可查记录，避免「数据库删了、文件还在却没有任何记录」
create table if not exists public.image_purge_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deleted_image_id uuid,
  storage_path text not null,
  error text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_purge_failures_user on public.image_purge_failures (user_id, resolved_at);

-- -------------------------------------------------------------------------------------
-- IV.6 索引：按角色 / 草稿 / 父图 / 错题查询
-- -------------------------------------------------------------------------------------
create index if not exists idx_mistake_images_role on public.mistake_images (user_id, mistake_id, image_role);
create index if not exists idx_mistake_images_draft on public.mistake_images (user_id, draft_id) where draft_id is not null;
create index if not exists idx_mistake_images_parent on public.mistake_images (parent_image_id) where parent_image_id is not null;
create index if not exists idx_ocr_jobs_image on public.ocr_jobs (user_id, image_id);

-- -------------------------------------------------------------------------------------
-- IV.7 视图：整题原图 + 其 OCR 结果（只读对照，方便详情页并排核对）
-- -------------------------------------------------------------------------------------
create or replace view public.full_page_captures as
select
  mi.id as image_id, mi.user_id, mi.mistake_id, mi.draft_id, mi.storage_path,
  mi.image_role, mi.created_at as image_created_at,
  oj.id as ocr_job_id, oj.status as ocr_status, oj.raw_text as ocr_text,
  oj.options as ocr_options, oj.formulas as ocr_formulas,
  oj.figure_description, oj.is_ai_description, oj.confidence,
  oj.applied_at as ocr_applied_at, oj.applied_field as ocr_applied_field,
  (select count(*) from public.mistake_images c
     where c.parent_image_id = mi.id and c.image_role = 'cropped') as cropped_count
from public.mistake_images mi
left join lateral (
  select * from public.ocr_jobs o
  where o.image_id = mi.id order by o.created_at desc limit 1
) oj on true
where mi.image_role = 'original';

comment on view public.full_page_captures is '整题原图与其最近一次 OCR 结果的对照视图；原图与 OCR 始终是两条独立记录';

-- -------------------------------------------------------------------------------------
-- IV.8 孤儿文件清单：只「列出」，由用户勾选确认后客户端删除，绝不自动删
--      用 security definer 读 storage.objects，但内部强制 auth.uid() 路径前缀限制。
--      同时排除：登记表、回收站登记表（未彻底删除）、错题/笔记富文本中的 data-storage-path 引用。
-- -------------------------------------------------------------------------------------
create or replace function public.list_orphan_images_v4(p_limit int default 200)
returns table (storage_path text, size_bytes bigint, created_at timestamptz, reason text)
language plpgsql security definer set search_path = public, storage as $$
begin
  return query
  select
    o.name::text,
    coalesce((o.metadata->>'size')::bigint, 0)::bigint,
    o.created_at,
    '数据库无引用（未在 mistake_images / attachments / 富文本 / 图片回收站中出现）'::text
  from storage.objects o
  where o.bucket_id = 'mistake-images'
    and (storage.foldername(o.name))[1] = auth.uid()::text
    and not exists (select 1 from public.mistake_images mi where mi.storage_path = o.name)
    and not exists (select 1 from public.attachments a where a.storage_path = o.name)
    and not exists (select 1 from public.deleted_images d where d.storage_path = o.name and d.purged_at is null)
    and not exists (
      select 1 from public.mistakes m
      where m.user_id = auth.uid()
        and (coalesce(m.content,'') like '%' || o.name || '%'
          or coalesce(m.answer,'') like '%' || o.name || '%'
          or coalesce(m.analysis,'') like '%' || o.name || '%')
    )
    and not exists (
      select 1 from public.notes n
      where n.user_id = auth.uid() and coalesce(n.content,'') like '%' || o.name || '%'
    )
  order by o.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
end $$;
revoke all on function public.list_orphan_images_v4(int) from public, anon;
grant execute on function public.list_orphan_images_v4(int) to authenticated;

-- -------------------------------------------------------------------------------------
-- IV.9 Storage 桶与策略加固：私有 + 8MB 单文件 + 白名单 MIME + 路径首段必须是自己
--      （PART I 已建过桶，这里 on conflict do update 收紧限制，重复执行无副作用）
-- -------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mistake-images', 'mistake-images', false, 8388608,
  array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "img_select_own" on storage.objects;
create policy "img_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'mistake-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "img_insert_own" on storage.objects;
create policy "img_insert_own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'mistake-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.filename(name)) ~ '^[0-9a-zA-Z._-]+\.(webp|jpg|jpeg|png|gif|heic|heif)$'
    and coalesce((metadata ->> 'size')::bigint, 0) <= 8388608
  );

drop policy if exists "img_update_own" on storage.objects;
create policy "img_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'mistake-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'mistake-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "img_delete_own" on storage.objects;
create policy "img_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'mistake-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- 路径约定：<uid>/mistakes/<整题|inline|cropped|thumbnail>/<实体id>/<uuid>.<ext>
-- ⚠️ 这里**不能**写 `comment on table storage.objects ...`：storage.objects 由 Supabase 内部角色
--    supabase_storage_admin 拥有，SQL Editor 连接的 postgres 既不是 owner 也不是 superuser；
--    supautils 只代理 policy 语句，不代理 COMMENT / ALTER TABLE，写了会抛
--    42501 must be owner of table objects 并中断整份脚本。说明信息用普通 SQL 注释保留即可。
--    （2026-11-09 真实报错后移除，见 docs/05 第 10 步排错表）

-- -------------------------------------------------------------------------------------
-- IV.10 新表 RLS：与全库一致，用户只能增删改查自己的数据
-- -------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['deleted_images','image_purge_failures'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own_rows" on public.%I', t);
    execute format($f$
      create policy "own_rows" on public.%I
        for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)
    $f$, t);
  end loop;
end $$;

-- -------------------------------------------------------------------------------------
-- IV.10b v4 新表显式授权（2026-11-09 加固，幂等）
--   背景：Supabase 自 2026-04-28 起，新建项目可关闭「Automatically expose new tables」；
--   关闭后 public schema 的新表不再自动获得 Data API 角色的 GRANT，
--   supabase-js 访问会报 42501 permission denied for table xxx。
--   本文件 PART IV 的 deleted_images / image_purge_failures 建在 IV.10 之前，
--   而原有 grant 只在 PART I(421) 与 PART III(907)，覆盖不到这两张新表。
--   这里补一次全量授权，让 schema.sql 自给自足、不依赖建库时的勾选项。
--   只授权网站实际使用的 authenticated 与 service_role（分享页 admin client），
--   不额外给 anon；所有表已由 IV.10 的循环开启 RLS 并写 own_rows 策略。
-- -------------------------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- IV.11 自检（在 Supabase SQL Editor 执行，期望结果写在每行后面）
-- -------------------------------------------------------------------------------------
-- select column_name, data_type from information_schema.columns
--   where table_schema='public' and table_name in ('mistake_images','attachments','ocr_jobs')
--     and (column_name ilike '%base64%' or column_name ilike '%blob%' or data_type in ('bytea'))
--   order by 1;                                             -- 期望：0 行
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='mistake_images'
--     and column_name in ('image_role','parent_image_id','crop_rect','original_size_bytes',
--       'compressed_size_bytes','is_original_backed_up','original_backup_note','draft_id','public_url')
--   order by 1;                                             -- 期望：9 行
-- select count(*) from storage.buckets where id='mistake-images' and public=false;  -- 期望：1
-- select * from public.list_orphan_images_v4(10);          -- 期望：刚上传但放弃保存的临时图会出现在这里
-- select tablename, rowsecurity from pg_tables
--   where schemaname='public' and tablename in ('deleted_images','image_purge_failures'); -- 期望 2 行 true
-- =====================================================================================
-- PART IV 完成。整份 schema.sql 仍是「从头执行一次即可」的幂等脚本，老库重跑不丢数据。
-- =====================================================================================
