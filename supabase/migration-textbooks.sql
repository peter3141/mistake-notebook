-- =====================================================================================
-- v5 增量迁移：按科目课本组卷（Textbook-based Paper Generation）
--
-- 【技术边界】Coding Plan 只有 Chat/Completions，没有联网搜索能力。
--   本模块的数据来源只有两种：用户上传/录入的课本材料，或用户维护的
--   「章节 ↔ 知识点 / 错题」映射。AI 不能也不允许「自己去搜课本」。
--
-- 【执行方式】Supabase SQL Editor 整份粘贴执行；幂等，可重复执行，不删改既有数据。
--   已部署过 v1~v4 的项目：只跑本文件即可；全新项目：先跑 schema.sql 再跑本文件。
--   顺序无副作用，因为本文件里的 bucket mime 更新是幂等的 update。
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 0. 现有表的增量列 / 约束：AI 子开关 + AI 任务种类
-- -------------------------------------------------------------------------------------
alter table public.user_settings
  add column if not exists ai_textbook_quiz boolean not null default false;  -- 课本 AI 出题，默认关

alter table public.ai_jobs drop constraint if exists ai_jobs_kind_check;
alter table public.ai_jobs add constraint ai_jobs_kind_check
  check (kind in ('organize','ocr','similar','batch','schedule','note','plan','textbook_quiz'));

-- -------------------------------------------------------------------------------------
-- 1. textbooks：课本
-- -------------------------------------------------------------------------------------
create table if not exists public.textbooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,  -- 科目
  name text not null,                                                 -- 课本名称
  publisher text not null default '',                                 -- 出版社
  edition text not null default '',                                   -- 版本（如 人教版2019 / 必修一）
  grade text not null default '',                                     -- 年级
  volume text not null default '',                                    -- 册次（上册 / 下册 / 必修一）
  cover_path text,                                                    -- 封面图：Storage 路径，绝不存 Base64
  note text not null default '',                                      -- 备注
  deleted_at timestamptz,                                             -- 软删除 → 统一回收站（30 天）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_textbooks_user on public.textbooks (user_id, deleted_at, created_at desc);
create index if not exists idx_textbooks_subject on public.textbooks (user_id, subject_id);

-- -------------------------------------------------------------------------------------
-- 2. textbook_chapters：课本章节（严格两级：level=1 章 → level=2 节）
--    parent_id 为空表示章；节必须挂在某个章下。深度由前端与写入逻辑保证。
-- -------------------------------------------------------------------------------------
create table if not exists public.textbook_chapters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  textbook_id uuid not null references public.textbooks(id) on delete cascade,
  parent_id uuid references public.textbook_chapters(id) on delete cascade,
  level smallint not null default 1 check (level in (1, 2)),
  chapter_no text not null default '',                                 -- 章节序号，如「第一章」「1.1」
  title text not null,                                                 -- 章节标题
  page_range text,                                                     -- 页码范围（可选）
  summary text not null default '',                                    -- 章节内容摘要（可选，AI 出题的可信材料）
  sort_order int not null default 0,                                   -- 拖拽排序
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_chapters_book on public.textbook_chapters (textbook_id, deleted_at, sort_order);
create index if not exists idx_chapters_parent on public.textbook_chapters (parent_id);

-- -------------------------------------------------------------------------------------
-- 3. chapter_knowledge_points：章节 ↔ 知识点映射（文本，可与错题的 knowledge_points / 标签匹配）
-- -------------------------------------------------------------------------------------
create table if not exists public.chapter_knowledge_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null references public.textbook_chapters(id) on delete cascade,
  knowledge_point text not null,
  weight numeric(5,2) not null default 1.00,                           -- 权重（抽题排序用，默认 1）
  created_at timestamptz not null default now(),
  unique (chapter_id, knowledge_point)
);
create index if not exists idx_ckp_chapter on public.chapter_knowledge_points (chapter_id);
create index if not exists idx_ckp_user on public.chapter_knowledge_points (user_id);

-- -------------------------------------------------------------------------------------
-- 4. chapter_mistakes：章节 ↔ 错题直接映射（可选；不映射时按知识点间接命中）
-- -------------------------------------------------------------------------------------
create table if not exists public.chapter_mistakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null references public.textbook_chapters(id) on delete cascade,
  mistake_id uuid not null references public.mistakes(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (chapter_id, mistake_id)
);
create index if not exists idx_cm_chapter on public.chapter_mistakes (chapter_id);
create index if not exists idx_cm_mistake on public.chapter_mistakes (mistake_id);

-- -------------------------------------------------------------------------------------
-- 5. textbook_materials：用户上传/录入的课本材料
--    ★ 图片 / PDF 只存 Storage 路径；ocr_text 是用户录入或本地 OCR 的文字，不含 Base64。
-- -------------------------------------------------------------------------------------
create table if not exists public.textbook_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null references public.textbook_chapters(id) on delete cascade,
  textbook_id uuid references public.textbooks(id) on delete cascade,  -- 冗余，便于回收站级联清理
  material_type text not null default 'image'
    check (material_type in ('catalog','text','example','image','pdf')),
  storage_path text,                                                   -- 手动录入的纯文本材料可为空
  mime_type text not null default '',
  size_bytes bigint not null default 0,
  ocr_text text,                                                       -- OCR 文本 / 粘贴的正文片段
  file_name text not null default '',
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_materials_chapter on public.textbook_materials (chapter_id, deleted_at, created_at);
create index if not exists idx_materials_book on public.textbook_materials (textbook_id);

-- -------------------------------------------------------------------------------------
-- 6. textbook_quiz_templates：按课本组卷配置模板（一键复用）
-- -------------------------------------------------------------------------------------
create table if not exists public.textbook_quiz_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- -------------------------------------------------------------------------------------
-- 7. RLS：以上 6 张新表全部启用，用户只能增删改查自己的数据
--    策略与 v1 的 "own_rows" 完全一致；幂等（drop policy if exists + create）。
-- -------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'textbooks','textbook_chapters','chapter_knowledge_points',
    'chapter_mistakes','textbook_materials','textbook_quiz_templates'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own_rows" on public.%I', t);
    execute format(
      'create policy "own_rows" on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t
    );
  end loop;
end $$;

-- -------------------------------------------------------------------------------------
-- 8. Storage：沿用同一个私有桶 mistake-images，仅补允许 PDF 片段
--    路径约定：<uid>/textbooks/<chapterId>/<uuid>.<ext>，仍命中既有
--    img_*_own 策略的 (storage.foldername(name))[1] = auth.uid() 前缀检查。
--
-- ★ 权限风险（v4 实测过同类坑）：storage.buckets 由 supabase_storage_admin 拥有，
--   SQL Editor 的 postgres 角色在某些项目上执行 UPDATE 会报
--   42501 must be owner of table buckets（与 comment on table storage.objects 同源）。
--   因此这里用异常保护包住：失败只 raise notice，**绝不中断整份脚本**，
--   后面的回收站扩展 / RPC / 授权照常执行。失败时的手动兜底见下方注释与
--   docs/03 V7.2、docs/05 第八部分。
-- -------------------------------------------------------------------------------------
do $$
begin
  update storage.buckets
     set allowed_mime_types = array[
       'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','application/pdf'
     ]
   where id = 'mistake-images';
exception when insufficient_privilege or undefined_column then
  raise notice '未能用 SQL 更新桶 MIME 白名单（%）；请在 Supabase → Storage → mistake-images → Configuration → Allowed MIME types 手动添加 application/pdf', sqlerrm;
end $$;
-- 手动兜底（仅当上面 notice 出现时）：Storage → mistake-images → Configuration
--   → Allowed MIME types 加 application/pdf → Save。图片上传不受影响，只有 PDF 片段会报 415。

-- -------------------------------------------------------------------------------------
-- 9. 统一回收站：课本 / 章节 / 材料三类实体也进 trash_items，30 天内可恢复
-- -------------------------------------------------------------------------------------
alter table public.trash_items drop constraint if exists trash_items_entity_type_check;
alter table public.trash_items add constraint trash_items_entity_type_check
  check (entity_type in ('mistake','schedule','task','note','habit','goal','textbook','chapter','material'));

-- 软删除登记（沿用 v2 的 sync_trash_item，标题列按表指定）
drop trigger if exists trg_trash_textbooks on public.textbooks;
create trigger trg_trash_textbooks after insert or update of deleted_at on public.textbooks
  for each row execute function public.sync_trash_item('textbook', 'name');

drop trigger if exists trg_trash_chapters on public.textbook_chapters;
create trigger trg_trash_chapters after insert or update of deleted_at on public.textbook_chapters
  for each row execute function public.sync_trash_item('chapter', 'title');

drop trigger if exists trg_trash_materials on public.textbook_materials;
create trigger trg_trash_materials after insert or update of deleted_at on public.textbook_materials
  for each row execute function public.sync_trash_item('material', 'file_name');

-- 硬删除注销登记表
drop trigger if exists trg_trash_del_textbooks on public.textbooks;
create trigger trg_trash_del_textbooks after delete on public.textbooks
  for each row execute function public.remove_trash_item('textbook');
drop trigger if exists trg_trash_del_chapters on public.textbook_chapters;
create trigger trg_trash_del_chapters after delete on public.textbook_chapters
  for each row execute function public.remove_trash_item('chapter');
drop trigger if exists trg_trash_del_materials on public.textbook_materials;
create trigger trg_trash_del_materials after delete on public.textbook_materials
  for each row execute function public.remove_trash_item('material');

-- 恢复：课本连带恢复其章节与材料；章节连带恢复其子节与材料
create or replace function public.restore_trash_item(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_table text; v_user uuid := auth.uid();
begin
  if v_user is null then raise exception '请先登录'; end if;
  if p_type = 'textbook' then
    update public.textbooks set deleted_at = null where id = p_id and user_id = v_user;
    update public.textbook_chapters set deleted_at = null where textbook_id = p_id and user_id = v_user;
    update public.textbook_materials set deleted_at = null
     where textbook_id = p_id and user_id = v_user;
    delete from public.trash_items
     where user_id = v_user and entity_type in ('chapter','material')
       and entity_id in (
         select id from public.textbook_chapters where textbook_id = p_id
         union select id from public.textbook_materials where textbook_id = p_id
       );
    return;
  end if;
  if p_type = 'chapter' then
    update public.textbook_chapters set deleted_at = null where id = p_id and user_id = v_user;
    update public.textbook_chapters set deleted_at = null where parent_id = p_id and user_id = v_user;
    update public.textbook_materials set deleted_at = null where chapter_id = p_id and user_id = v_user;
    delete from public.trash_items
     where user_id = v_user and entity_type in ('chapter','material')
       and entity_id in (
         select id from public.textbook_chapters where parent_id = p_id
         union select id from public.textbook_materials where chapter_id = p_id
       );
    return;
  end if;
  v_table := case p_type
    when 'mistake' then 'mistakes' when 'schedule' then 'schedules'
    when 'task' then 'tasks' when 'note' then 'notes'
    when 'habit' then 'habits' when 'goal' then 'goals'
    when 'material' then 'textbook_materials' end;
  if v_table is null then raise exception '非法实体类型'; end if;
  execute format('update public.%I set deleted_at = null where id = $1 and user_id = $2', v_table)
    using p_id, v_user;
end $$;

-- 彻底删除：课本连带删除章节 / 材料 / 映射（FK on delete cascade 兜底），并清掉幽灵登记
create or replace function public.purge_trash_item(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_table text; v_user uuid := auth.uid();
begin
  if v_user is null then raise exception '请先登录'; end if;
  if p_type = 'textbook' then
    delete from public.trash_items
     where user_id = v_user and entity_type in ('chapter','material')
       and entity_id in (
         select id from public.textbook_chapters where textbook_id = p_id
         union select id from public.textbook_materials where textbook_id = p_id
       );
    delete from public.textbooks where id = p_id and user_id = v_user and deleted_at is not null;
    return;
  end if;
  v_table := case p_type
    when 'mistake' then 'mistakes' when 'schedule' then 'schedules'
    when 'task' then 'tasks' when 'note' then 'notes'
    when 'habit' then 'habits' when 'goal' then 'goals'
    when 'chapter' then 'textbook_chapters' when 'material' then 'textbook_materials' end;
  if v_table is null then raise exception '非法实体类型'; end if;
  execute format('delete from public.%I where id = $1 and user_id = $2 and deleted_at is not null', v_table)
    using p_id, v_user;
  delete from public.trash_items where entity_type = p_type and entity_id = p_id and user_id = v_user;
end $$;

-- 过期清理：把 3 张新表纳入 30 天清理（课本靠 FK 级联子表）
create or replace function public.purge_expired_trash()
returns integer language plpgsql security definer set search_path = public as $$
declare v_cnt int := 0; v_n int; t text;
begin
  if auth.uid() is null then return 0; end if;
  foreach t in array array[
    'mistakes','schedules','tasks','notes','habits','goals',
    'textbooks','textbook_chapters','textbook_materials'
  ] loop
    execute format($f$
      delete from public.%I
       where user_id = auth.uid() and deleted_at is not null
         and deleted_at < now() - interval '30 days'
    $f$, t);
    get diagnostics v_n = row_count;
    v_cnt := v_cnt + v_n;
  end loop;
  delete from public.trash_items where user_id = auth.uid() and expires_at <= now();
  return v_cnt;
end $$;

-- 注销账号：把课本模块数据一并清空（保持原有 6 类模块不变）
create or replace function public.delete_my_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.textbooks where user_id = auth.uid();          -- 级联章节 / 材料 / 映射
  delete from public.textbook_quiz_templates where user_id = auth.uid();
  delete from public.mistakes where user_id = auth.uid();
  delete from public.schedules where user_id = auth.uid();
  delete from public.tasks where user_id = auth.uid();
  delete from public.notes where user_id = auth.uid();
  delete from public.habits where user_id = auth.uid();
  delete from public.goals where user_id = auth.uid();
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
-- 9b. 显式授权 ★ 与 schema.sql IV.10b 是同一个坑
--     PART I/II/III/IV 的 grant 只在建库那一次执行，覆盖不到本文件新建的 6 张表。
--     建项目时若没勾 "Automatically expose new tables"，前端读写会报
--     42501 permission denied for table textbooks。这里补一次全量授权，
--     让迁移自给自足、不依赖建库勾选项。只授权 authenticated / service_role，
--     不开放 anon；6 张表已全部启用 RLS 并有 own_rows 策略兜底。
-- -------------------------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant execute on function public.restore_trash_item(text, uuid) to authenticated;
grant execute on function public.purge_trash_item(text, uuid) to authenticated;
grant execute on function public.purge_expired_trash() to authenticated;
grant execute on function public.delete_my_data() to authenticated;

-- -------------------------------------------------------------------------------------
-- 10. 执行后自检（把下面 4 条单独跑，预期结果写在注释里）
-- -------------------------------------------------------------------------------------
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='user_settings' and column_name like 'ai_%';
--   → 应包含 ai_textbook_quiz
-- select tablename, rowsecurity from pg_tables
--  where schemaname='public' and (tablename like 'textbook%' or tablename like 'chapter_%');
--   → rowsecurity 全部为 true（注意括号：不加括号时 AND/OR 优先级会让 schemaname 条件失效）
-- select public.unified_trash();  -- 应返回 jsonb 数组（无删除数据时为 []）
-- 四合一验收（一行四个数，预期 6 | 6 | 1 | 1）：
-- select
--   (select count(*) from pg_tables where schemaname='public' and tablename in
--      ('textbooks','textbook_chapters','chapter_knowledge_points','chapter_mistakes','textbook_materials','textbook_quiz_templates')) as v5_tables,
--   (select count(*) from pg_tables where schemaname='public' and rowsecurity and tablename in
--      ('textbooks','textbook_chapters','chapter_knowledge_points','chapter_mistakes','textbook_materials','textbook_quiz_templates')) as v5_rls_true,
--   (select count(*) from information_schema.role_table_grants where table_schema='public'
--      and table_name='textbooks' and grantee='authenticated' and privilege_type='SELECT') as grant_ok,
--   (select count(*) from information_schema.columns where table_schema='public'
--      and table_name='user_settings' and column_name='ai_textbook_quiz') as ai_flag;
-- =====================================================================================
-- 新增表清单（6 张）+ 新增字段/约束（2 处）+ 回收站扩展（3 类实体）
--   textbooks                     课本
--   textbook_chapters             两级章节
--   chapter_knowledge_points      章节↔知识点（含权重）
--   chapter_mistakes              章节↔错题
--   textbook_materials            课本材料（只存 Storage 路径）
--   textbook_quiz_templates       组卷配置模板
-- RLS：6 张新表全部 enable row level security + "own_rows" 策略
--       （for all to authenticated，using / with check 都是 auth.uid() = user_id）
-- =====================================================================================
