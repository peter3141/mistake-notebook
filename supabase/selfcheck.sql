-- =====================================================================================
-- 真实联调 · 数据库自检（只读，不修改任何数据）
-- 用法：Supabase → SQL Editor → New query → 整份粘贴 → Run
-- 预期：一次返回 10 行，status 全部为 OK（最后一行 INFO 除外）。
-- 把结果截图发给助手即可定位问题。
-- =====================================================================================

with expected_tables(name) as (
  values
    ('profiles'),('subjects'),('mistake_books'),('mistakes'),('mistake_images'),('tags'),
    ('mistake_tags'),('review_logs'),('practice_logs'),('ai_jobs'),('ai_usage_logs'),
    ('mistake_versions'),('print_templates'),('share_links'),('ocr_jobs'),('user_settings'),
    ('schedules'),('schedule_reminders'),('tasks'),('subtasks'),('notes'),('note_versions'),
    ('habits'),('habit_logs'),('focus_sessions'),('goals'),('goal_milestones'),
    ('attachments'),('trash_items'),('deleted_images'),('image_purge_failures')
),
checks as (
  select 1 as ord, '1. 业务表齐全（应为 31 张）' as item,
         (select count(*) from pg_tables t join expected_tables e on e.name = t.tablename
           where t.schemaname = 'public')::text as actual,
         '31' as expected

  union all
  select 2, '2. 上述表全部开启 RLS',
         (select count(*) from pg_tables t join expected_tables e on e.name = t.tablename
           where t.schemaname = 'public' and t.rowsecurity = true)::text,
         (select count(*) from pg_tables t join expected_tables e on e.name = t.tablename
           where t.schemaname = 'public')::text

  union all
  select 3, '3. RLS 策略数量（应 > 25）',
         (select count(*) from pg_policies where schemaname = 'public')::text,
         '>25'

  union all
  select 4, '4. 图片桶 mistake-images 存在且私有',
         (select count(*) from storage.buckets where id = 'mistake-images' and public = false)::text,
         '1'

  union all
  select 5, '5. user_settings 的 AI 开关列（应 >= 10）',
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'user_settings'
             and column_name like 'ai_%')::text,
         '>=10'

  union all
  select 6, '6. habit_logs 唯一约束（补录防重复）',
         (select count(*) from pg_indexes
           where schemaname = 'public' and tablename = 'habit_logs'
             and indexdef ilike '%unique%')::text,
         '>=1'

  union all
  select 7, '7. 历史版本 / 回收站 / updated_at 触发器（应 > 0）',
         (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and not t.tgisinternal)::text,
         '>0'

  union all
  select 8, '8. 注销 / 回收站清理 / 统一回收站函数',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('delete_my_data','purge_expired_trash','unified_trash','sync_trash_item'))::text,
         '4'

  union all
  select 9, '9. 重复打卡天数（应为 0）',
         (select count(*) from (
            select user_id, habit_id, log_date from public.habit_logs
            group by 1,2,3 having count(*) > 1
          ) d)::text,
         '0'

  union all
  select 10, '10. INFO：当前库已注册用户数（仅参考）',
         (select count(*) from auth.users)::text,
         'INFO'
)
select ord as "序号", item as "检查项", actual as "实际值", expected as "期望值",
       case
         when expected = 'INFO' then 'INFO'
         when expected like '>=%' then case when actual::int >= replace(expected,'>=','')::int then 'OK' else 'CHECK' end
         when expected like '>%' then case when actual::int > replace(expected,'>','')::int then 'OK' else 'CHECK' end
         when actual = expected then 'OK' else 'CHECK'
       end as "status"
from checks
order by ord;

-- 附：如果第 6 / 9 项不是 OK，单独跑下面两条定位（只读）：
-- select indexname, indexdef from pg_indexes where schemaname='public' and tablename='habit_logs';
-- select user_id, habit_id, log_date, count(*) from public.habit_logs group by 1,2,3 having count(*) > 1;
-- =====================================================================================
-- 结束。下一步按 docs/08-真实联调清单.md 第 2 节跑本机脚本。
-- =====================================================================================
