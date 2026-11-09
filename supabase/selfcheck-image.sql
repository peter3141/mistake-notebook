-- =====================================================================================
-- 图片架构 v4 · 数据库自检（在 Supabase SQL Editor 整份粘贴执行）
-- 期望：断言项 status = OK（第 1/2/3/4/6/7/9 共 7 项）；其余为人工核对清单（INFO，含第 10 项孤儿文件仅列出不删除）。
-- =====================================================================================

-- 1) 图片相关表不得存在 Base64 / Blob / bytea 列
select '1. 无图片二进制字段' as item,
       count(*)::text as actual, '=0' as expected,
       case when count(*) = 0 then 'OK' else 'CHECK' end as status
from information_schema.columns
where table_schema = 'public'
  and table_name in ('mistake_images','attachments','ocr_jobs','deleted_images')
  and (column_name ilike '%base64%' or column_name ilike '%blob%' or column_name ilike '%bytes_data%'
       or data_type = 'bytea');

-- 2) v4 新字段齐全（期望 9）
select '2. v4 新字段数量' as item,
       count(*)::text as actual, '=9' as expected,
       case when count(*) = 9 then 'OK' else 'CHECK' end as status
from information_schema.columns
where table_schema='public' and table_name='mistake_images'
  and column_name in ('image_role','parent_image_id','crop_rect','original_size_bytes',
    'compressed_size_bytes','is_original_backed_up','original_backup_note','draft_id','public_url');

-- 3) 桶必须私有，单文件上限 8MB
select '3. 私有桶' as item,
       count(*)::text as actual, '=1' as expected,
       case when count(*) = 1 then 'OK' else 'CHECK' end as status
from storage.buckets
where id = 'mistake-images' and public = false and file_size_limit = 8388608;

-- 4) 新表 RLS 已开启（期望 2）
select '4. 图片回收站与失败表 RLS' as item,
       count(*)::text as actual, '=2' as expected,
       case when count(*) = 2 then 'OK' else 'CHECK' end as status
from pg_tables
where schemaname='public' and tablename in ('deleted_images','image_purge_failures') and rowsecurity = true;

-- 5) 整题原图数量（人工核对用）
select '5. 整题原图数量' as item, count(*)::text as actual, 'INFO' as expected, 'INFO' as status
from public.mistake_images where image_role = 'original';

-- 6) 裁剪图数量与其父图关联（期望 0 条孤立裁剪图）
select '6. 孤立裁剪图' as item, count(*)::text as actual, '=0' as expected,
       case when count(*) = 0 then 'OK' else 'CHECK' end as status
from public.mistake_images c
where c.image_role = 'cropped' and c.parent_image_id is not null
  and not exists (select 1 from public.mistake_images p where p.id = c.parent_image_id);

-- 7) 富文本仍含 Base64 图片的错题数（迁移后期望 0）
select '7. 富文本残留 Base64' as item, count(*)::text as actual, '=0' as expected,
       case when count(*) = 0 then 'OK' else 'CHECK' end as status
from public.mistakes
where coalesce(content,'') like '%data:image/%'
   or coalesce(answer,'') like '%data:image/%'
   or coalesce(analysis,'') like '%data:image/%';

-- 8) 图片回收站中未彻底删除的记录数（人工核对用）
select '8. 图片回收站待清理' as item, count(*)::text as actual, 'INFO' as expected, 'INFO' as status
from public.deleted_images where purged_at is null;

-- 9) Storage 删除失败未处理记录（期望 0）
select '9. 未处理的删除失败' as item, count(*)::text as actual, '=0' as expected,
       case when count(*) = 0 then 'OK' else 'CHECK' end as status
from public.image_purge_failures where resolved_at is null;

-- 10) 孤儿文件清单（只列出，不删除；需要清理请在「回收站 → 孤儿文件扫描」勾选确认）
select '10. 孤儿文件（仅列出）' as item, count(*)::text as actual, 'INFO' as expected, 'INFO' as status
from public.list_orphan_images_v4(200);

-- 11) 随机抽 5 张图，肉眼核对路径规范与角色（迁移后验证用）
select '11. 随机 5 张图' as item, string_agg(image_role || ':' || split_part(storage_path,'/',3), ', ') as actual,
       'INFO' as expected, 'INFO' as status
from (select image_role, storage_path from public.mistake_images order by random() limit 5) t;

-- 12) 随机抽 3 道带整题原图的错题，核对原图与 OCR 文字（迁移后验证用）
select '12. 随机 3 道整题错题' as item,
       string_agg(v.image_id::text || '/' || coalesce(v.ocr_status,'no-ocr'), ', ') as actual,
       'INFO' as expected, 'INFO' as status
from (select image_id, ocr_status from public.full_page_captures order by random() limit 3) v;
