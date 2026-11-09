'use client'

/**
 * v2（第 7 段）数据层：日程 / 待办 / 笔记 / 习惯 / 番茄钟 / 目标 / 统一搜索 / 统一回收站
 * 全部走浏览器端 Supabase 客户端，靠 RLS 保证「只能读写自己的数据」。
 * 软删除统一只更新 deleted_at，由数据库触发器自动登记到 trash_items。
 */
import { createClient } from './supabase/client'
import { sanitizeHtml, todayISO, stripHtml } from './utils'
import type {
  Schedule, ScheduleInput, Task, TaskInput, Subtask, Note, NoteInput, NoteVersion,
  Habit, HabitInput, HabitLog, FocusSession, Goal, GoalInput, GoalMilestone,
  TrashItem, TrashEntityType, SearchHit, OverviewStats, Mistake
} from '@/types'

export const db2 = () => createClient()

async function me() {
  const { data } = await db2().auth.getUser()
  if (!data.user) throw new Error('请先登录')
  return data.user.id
}

const TABLE_OF: Record<TrashEntityType, string> = {
  mistake: 'mistakes', schedule: 'schedules', task: 'tasks',
  note: 'notes', habit: 'habits', goal: 'goals'
}

// ===========================================================================
// 日程
// ===========================================================================
const SCHEDULE_SELECT = '*, mistake:mistakes(id,title)'

export async function listSchedules(from?: string, to?: string) {
  let q = db2().from('schedules').select(SCHEDULE_SELECT).is('deleted_at', null)
  if (from) q = q.gte('start_at', from)
  if (to) q = q.lte('start_at', to)
  const { data, error } = await q.order('start_at', { ascending: true }).limit(1000)
  if (error) throw error
  return (data || []) as Schedule[]
}

export async function upsertSchedule(input: ScheduleInput, id?: string) {
  const user_id = await me()
  const payload: any = { ...input, user_id }
  delete payload.id; delete payload.created_at; delete payload.updated_at; delete payload.mistake
  const q = id
    ? db2().from('schedules').update(payload).eq('id', id).eq('user_id', user_id)
    : db2().from('schedules').insert(payload)
  const { data, error } = await q.select('id').single()
  if (error) throw error
  // 提醒记录：随日程重建一条，供首页提醒条展示（先删后插，避免重复）
  if (input.start_at && input.remind_minutes !== undefined) {
    const remindAt = new Date(new Date(input.start_at).getTime() - (input.remind_minutes || 0) * 60000).toISOString()
    await db2().from('schedule_reminders').delete().eq('schedule_id', data.id)
    await db2().from('schedule_reminders').insert({
      user_id, schedule_id: data.id, remind_at: remindAt, channel: 'inapp'
    })
  }
  return data.id as string
}

/** 错题复习计划 → 一键生成日程（联动 1） */
export async function createReviewSchedule(m: Pick<Mistake, 'id' | 'title' | 'next_review_at'>, minutes = 30) {
  const start = new Date(m.next_review_at)
  if (isNaN(start.getTime())) start.setTime(Date.now() + 86400000)
  const end = new Date(start.getTime() + minutes * 60000)
  return upsertSchedule({
    title: `复习：${m.title}`.slice(0, 200),
    description: '由错题复习计划自动生成，点击可跳转到原题',
    start_at: start.toISOString(), end_at: end.toISOString(),
    category: '复习', priority: 1, remind_minutes: 15, mistake_id: m.id, status: 'todo'
  })
}

/** AI 预览确认后才调用本函数真正创建日程 */
export async function confirmParsedSchedule(v: {
  title: string; start_at: string; end_at: string | null; all_day: boolean
  location: string; category: string; priority: 1 | 2 | 3; repeat_rule: string; notes: string
}) {
  return upsertSchedule({
    title: v.title, start_at: v.start_at, end_at: v.end_at, all_day: v.all_day,
    location: v.location, category: v.category, priority: v.priority,
    repeat_rule: v.repeat_rule as any, description: v.notes, status: 'todo'
  })
}

export async function setScheduleStatus(id: string, status: 'todo' | 'done' | 'cancelled') {
  const { error } = await db2().from('schedules').update({ status }).eq('id', id)
  if (error) throw error
}

// ===========================================================================
// 待办任务
// ===========================================================================
const TASK_SELECT = '*, mistake:mistakes(id,title), subtasks(id,title,done,sort_order)'

export async function listTasks(opts: { includeDone?: boolean; limit?: number } = {}) {
  let q = db2().from('tasks').select(TASK_SELECT).is('deleted_at', null)
  if (!opts.includeDone) q = q.eq('completed', false)
  const { data, error } = await q.order('priority').order('due_at', { ascending: true, nullsFirst: false }).limit(opts.limit || 500)
  if (error) throw error
  return (data || []) as Task[]
}

export async function upsertTask(input: TaskInput, id?: string) {
  const user_id = await me()
  const payload: any = { ...input, user_id }
  delete payload.id; delete payload.created_at; delete payload.updated_at; delete payload.subtasks; delete payload.mistake
  const q = id
    ? db2().from('tasks').update(payload).eq('id', id).eq('user_id', user_id)
    : db2().from('tasks').insert(payload)
  const { data, error } = await q.select('id').single()
  if (error) throw error
  return data.id as string
}

export async function toggleTask(id: string, completed: boolean) {
  const { error } = await db2().from('tasks').update({
    completed, completed_at: completed ? new Date().toISOString() : null
  }).eq('id', id)
  if (error) throw error
}

export async function addSubtask(taskId: string, title: string) {
  const user_id = await me()
  const { error } = await db2().from('subtasks').insert({ user_id, task_id: taskId, title })
  if (error) throw error
}
export async function toggleSubtask(id: string, done: boolean) {
  const { error } = await db2().from('subtasks').update({ done }).eq('id', id)
  if (error) throw error
}
export async function deleteSubtask(id: string) {
  await db2().from('subtasks').delete().eq('id', id)
}

/** 错题复习计划 → 一键生成待办（联动 1） */
export async function createReviewTask(m: Pick<Mistake, 'id' | 'title' | 'next_review_at'>) {
  return upsertTask({
    title: `重练：${m.title}`.slice(0, 200),
    description: '由错题复习计划自动生成',
    due_at: m.next_review_at, priority: 1, mistake_id: m.id, tags: ['复习']
  })
}

// ===========================================================================
// 笔记
// ===========================================================================
export async function listNotes(q = '') {
  let query = db2().from('notes').select('*').is('deleted_at', null)
  if (q.trim()) {
    const s = q.replace(/[(),.%'"\\]/g, ' ').trim().slice(0, 80)
    if (s) query = query.or(`title.ilike.%${s}%,content.ilike.%${s}%,summary.ilike.%${s}%`)
  }
  const { data, error } = await query.order('updated_at', { ascending: false }).limit(300)
  if (error) throw error
  return (data || []) as Note[]
}

export async function getNote(id: string) {
  const { data, error } = await db2().from('notes').select('*').eq('id', id).single()
  if (error) throw error
  return data as Note
}

export async function upsertNote(input: NoteInput, id?: string) {
  const user_id = await me()
  const payload: any = { ...input, user_id }
  if (payload.content !== undefined) payload.content = sanitizeHtml(payload.content)
  delete payload.id; delete payload.created_at; delete payload.updated_at
  const q = id
    ? db2().from('notes').update(payload).eq('id', id).eq('user_id', user_id)
    : db2().from('notes').insert(payload)
  const { data, error } = await q.select('id').single()
  if (error) throw error
  return data.id as string
}

export async function listNoteVersions(noteId: string) {
  const { data } = await db2().from('note_versions').select('*').eq('note_id', noteId).order('version_no', { ascending: false })
  return (data || []) as NoteVersion[]
}

export async function rollbackNote(noteId: string, v: NoteVersion) {
  const s: any = v.snapshot
  await upsertNote({ title: s.title, content: s.content, tags: s.tags, summary: s.summary }, noteId)
}

/** 笔记图片：上传私有桶并登记 attachments；返回 storage_path 数组 */
export async function uploadNoteImages(noteId: string, files: File[]) {
  const supabase = db2()
  const user_id = await me()
  const paths: string[] = []
  for (const file of files.slice(0, 9)) {
    const path = `${user_id}/notes/${noteId}/${crypto.randomUUID()}.webp`
    const { error } = await supabase.storage.from('mistake-images').upload(path, file, { contentType: file.type, upsert: false })
    if (error) throw error
    await supabase.from('attachments').insert({
      user_id, entity_type: 'note', entity_id: noteId,
      storage_path: path, mime_type: file.type, size_bytes: file.size
    })
    paths.push(path)
  }
  return paths
}

/** 把 HTML 里的 data-storage-path 换成 1 小时签名 URL（打印/展示用） */
export async function hydrateNoteHtml(html: string) {
  const paths = [...html.matchAll(/data-storage-path="([^"]+)"/g)].map((m) => m[1])
  if (!paths.length) return html
  const { data } = await db2().storage.from('mistake-images').createSignedUrls([...new Set(paths)], 3600)
  const map = new Map((data || []).map((d: any) => [d.path, d.signedUrl]))
  return html.replace(/data-storage-path="([^"]+)"/g, (_all, p: string) => `src="${map.get(p) || ''}" data-storage-path="${p}"`)
}

/** 生成笔记的只读分享链接（与错题共用 share_links） */
export async function createNoteShare(noteId: string, days = 7) {
  const r = await fetch('/api/share', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: 'note', target_id: noteId, expiresInDays: days })
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || '生成分享失败')
  return j.url as string
}

// ===========================================================================
// 习惯打卡
// ===========================================================================
/**
 * 加载习惯 + 全部历史打卡记录。
 *
 * 补完说明（历史日期补录）：
 *  - 以前只查「本月」记录，补录上个月/前天不会刷新连续天数与月视图；
 *  - 现在一次性读取当前用户的**全部** habit_logs（RLS 过滤，个人量级通常几百到几千行，
 *    一次查询 + 前端 O(N) 计算，实测毫秒级），月视图、KPI、连续天数都由这份全量数据重算；
 *  - 连续天数最多回溯 730 天，避免极端数据把循环拉长；数据库已有
 *    unique(habit_id, log_date) 与 idx_habit_logs_user_date 索引保证不重复、查询不慢。
 *  - 性能影响：日志量每多 1000 行，单次刷新约增加几十 KB 传输；如超过 5000 行，
 *    可在 Supabase 给 habit_logs(user_id, log_date) 建索引（脚本里已建）。
 */
export async function listHabits() {
  const supabase = db2()
  const { data: habits, error } = await supabase.from('habits').select('*')
    .is('deleted_at', null).eq('archived', false).order('created_at')
  if (error) throw error
  const { data: logs } = await supabase.from('habit_logs')
    .select('habit_id, log_date, note').order('log_date')
  const byHabit = new Map<string, string[]>()
  ;(logs || []).forEach((l: { habit_id: string; log_date: string; note: string }) => {
    const arr = byHabit.get(l.habit_id) || []
    arr.push(l.log_date); byHabit.set(l.habit_id, arr)
  })
  const today = todayISO()
  const monthPrefix = today.slice(0, 7)
  return (habits || []).map((h: any) => {
    const all = [...new Set(byHabit.get(h.id) || [])].sort()
    const dates = all.filter((d) => d.startsWith(monthPrefix))
    const checkedToday = all.includes(today)
    // 连续天数：从今天（若今天没打卡则从昨天）往回数，最多 730 天
    let streak = 0
    const cursor = new Date()
    if (!checkedToday) cursor.setDate(cursor.getDate() - 1)
    const set = new Set(all)
    for (let i = 0; i < 730; i++) {
      if (!set.has(todayISOFrom(cursor))) break
      streak++; cursor.setDate(cursor.getDate() - 1)
    }
    return { ...h, checkedToday, streak, monthLogs: dates, allLogs: all } as Habit
  }) as Habit[]
}

function todayISOFrom(d: Date) { return d.toLocaleDateString('sv-SE') }

export async function upsertHabit(input: HabitInput, id?: string) {
  const user_id = await me()
  const payload: any = { ...input, user_id }
  delete payload.id; delete payload.created_at; delete payload.updated_at
  delete payload.streak; delete payload.checkedToday; delete payload.monthLogs
  const q = id
    ? db2().from('habits').update(payload).eq('id', id).eq('user_id', user_id)
    : db2().from('habits').insert(payload)
  const { data, error } = await q.select('id').single()
  if (error) throw error
  return data.id as string
}

export async function toggleHabitLog(habitId: string, date = todayISO(), checked?: boolean) {
  const supabase = db2()
  const user_id = await me()
  const { data: exist } = await supabase.from('habit_logs').select('id')
    .eq('habit_id', habitId).eq('log_date', date).maybeSingle()
  const shouldCheck = checked === undefined ? !exist : checked
  if (shouldCheck && !exist) {
    const { error } = await supabase.from('habit_logs').insert({ user_id, habit_id: habitId, log_date: date })
    if (error) throw error
  } else if (!shouldCheck && exist) {
    const { error } = await supabase.from('habit_logs').delete().eq('id', exist.id)
    if (error) throw error
  }
}

// ---------------------------------------------------------------------------
// 补完：历史日期补录 / 取消 / 防重复
// ---------------------------------------------------------------------------

export async function getHabitLog(habitId: string, date: string): Promise<HabitLog | null> {
  const { data } = await db2().from('habit_logs').select('*')
    .eq('habit_id', habitId).eq('log_date', date).maybeSingle()
  return (data as HabitLog) || null
}

/**
 * 补录某一天。allowOverwrite=false 时若当天已打卡，抛「已打卡，是否修改」让 UI 二次确认；
 * 数据库还有 unique(habit_id, log_date) 兜底，唯一键冲突也会给出同样提示。
 */
export async function upsertHabitLog(habitId: string, date: string, note = '', allowOverwrite = false) {
  const supabase = db2()
  const user_id = await me()
  const exist = await getHabitLog(habitId, date)
  if (exist && !allowOverwrite) throw new Error('已打卡，是否修改')
  if (exist) {
    const { error } = await supabase.from('habit_logs').update({ note })
      .eq('id', exist.id).eq('user_id', user_id)
    if (error) throw error
    return { updated: true, created: false }
  }
  const { error } = await supabase.from('habit_logs')
    .insert({ user_id, habit_id: habitId, log_date: date, note })
  if (error) {
    if (String(error.code) === '23505') throw new Error('已打卡，是否修改')
    throw error
  }
  return { updated: false, created: true }
}

export async function removeHabitLog(habitId: string, date: string) {
  const supabase = db2()
  const user_id = await me()
  const { error } = await supabase.from('habit_logs').delete()
    .eq('habit_id', habitId).eq('log_date', date).eq('user_id', user_id)
  if (error) throw error
}

// ===========================================================================
// 番茄钟
// ===========================================================================
const FOCUS_SELECT = '*, task:tasks(id,title), mistake:mistakes(id,title)'

export async function listFocusSessions(limit = 200) {
  const { data, error } = await db2().from('focus_sessions').select(FOCUS_SELECT)
    .order('started_at', { ascending: false }).limit(limit)
  if (error) throw error
  return (data || []) as FocusSession[]
}

export async function saveFocusSession(input: {
  task_id?: string | null; mistake_id?: string | null
  started_at: string; ended_at: string; duration_minutes: number; note?: string
}) {
  const user_id = await me()
  const { data, error } = await db2().from('focus_sessions').insert({
    user_id, task_id: input.task_id || null, mistake_id: input.mistake_id || null,
    started_at: input.started_at, ended_at: input.ended_at,
    duration_minutes: Math.max(0, Math.round(input.duration_minutes)),
    mode: 'focus', note: input.note || ''
  }).select('id').single()
  if (error) throw error
  // 联动：把专注时长累计到关联待办
  if (input.task_id) {
    const { data: t } = await db2().from('tasks').select('focus_minutes').eq('id', input.task_id).single()
    await db2().from('tasks').update({ focus_minutes: (t?.focus_minutes || 0) + Math.round(input.duration_minutes) }).eq('id', input.task_id)
  }
  return data.id as string
}

export async function listFocusTargets() {
  const supabase = db2()
  const [{ data: tasks }, { data: mistakes }] = await Promise.all([
    supabase.from('tasks').select('id,title').is('deleted_at', null).eq('completed', false).limit(100),
    supabase.from('mistakes').select('id,title').is('deleted_at', null).limit(100)
  ])
  return { tasks: tasks || [], mistakes: mistakes || [] }
}

// ===========================================================================
// 目标管理
// ===========================================================================
export async function listGoals() {
  const supabase = db2()
  const [{ data: goals }, { data: ms }] = await Promise.all([
    supabase.from('goals').select('*').is('deleted_at', null).order('created_at'),
    supabase.from('goal_milestones').select('*').order('sort_order')
  ])
  const byGoal = new Map<string, GoalMilestone[]>()
  ;(ms || []).forEach((m: GoalMilestone) => {
    const arr = byGoal.get(m.goal_id) || []; arr.push(m); byGoal.set(m.goal_id, arr)
  })
  return (goals || []).map((g: any) => ({ ...g, milestones: byGoal.get(g.id) || [] })) as Goal[]
}

export async function upsertGoal(input: GoalInput, id?: string) {
  const user_id = await me()
  const payload: any = { ...input, user_id }
  delete payload.id; delete payload.created_at; delete payload.updated_at; delete payload.milestones
  const q = id
    ? db2().from('goals').update(payload).eq('id', id).eq('user_id', user_id)
    : db2().from('goals').insert(payload)
  const { data, error } = await q.select('id').single()
  if (error) throw error
  return data.id as string
}

export async function addMilestone(goalId: string, title: string) {
  const user_id = await me()
  const { error } = await db2().from('goal_milestones').insert({ user_id, goal_id: goalId, title })
  if (error) throw error
}
export async function toggleMilestone(id: string, done: boolean) {
  await db2().from('goal_milestones').update({ done }).eq('id', id)
}
export async function deleteMilestone(id: string) {
  await db2().from('goal_milestones').delete().eq('id', id)
}
/** 进度 = 里程碑完成率；没有里程碑时按 status 给 0/100 */
export async function recalcGoalProgress(goalId: string) {
  const { data } = await db2().from('goal_milestones').select('done').eq('goal_id', goalId)
  const total = data?.length || 0
  const done = (data || []).filter((m) => m.done).length
  const progress = total ? Math.round(done / total * 100) : 0
  await db2().from('goals').update({ progress, status: progress === 100 && total ? 'done' : 'active' }).eq('id', goalId)
  return progress
}

// ===========================================================================
// 统一回收站
// ===========================================================================
export async function softDelete(type: TrashEntityType, id: string) {
  const { error } = await db2().from(TABLE_OF[type]).update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}
export async function unifiedTrash(): Promise<TrashItem[]> {
  const { data, error } = await db2().rpc('unified_trash')
  if (error) throw error
  return (Array.isArray(data) ? data : []) as TrashItem[]
}
export async function restoreTrash(type: TrashEntityType, id: string) {
  const { error } = await db2().rpc('restore_trash_item', { p_type: type, p_id: id })
  if (error) throw error
}
export async function purgeTrash(type: TrashEntityType, id: string) {
  // ★ v4：彻底删除错题时，才把该错题名下的 Storage 图片物理删掉。
  //   软删除（进回收站）阶段 Storage 文件保留，30 天内可恢复。
  if (type === 'mistake') {
    const { removeStorageFilesForMistake } = await import('./data')
    await removeStorageFilesForMistake(id)
  }
  // 笔记正文里的 data-storage-path 图片同样在彻底删除时清理
  if (type === 'note') {
    const supabase = db2()
    const { data: n } = await supabase.from('notes').select('content').eq('id', id).maybeSingle()
    const paths = [...String(n?.content || '').matchAll(/data-storage-path="([^"]+)"/g)].map((m) => m[1])
    const { data: att } = await supabase.from('attachments').select('storage_path').eq('entity_type', 'note').eq('entity_id', id)
    const all = [...new Set([...paths, ...(att || []).map((a: any) => a.storage_path as string)])]
    if (all.length) await supabase.storage.from('mistake-images').remove(all)
  }
  const { error } = await db2().rpc('purge_trash_item', { p_type: type, p_id: id })
  if (error) throw error
}
export async function clearAllTrash() {
  const items = await unifiedTrash()
  for (const it of items) await purgeTrash(it.entity_type, it.entity_id)
  return items.length
}

// ===========================================================================
// 统一搜索：错题 / 日程 / 待办 / 笔记 / 标签
// ===========================================================================
export async function searchAll(raw: string): Promise<SearchHit[]> {
  const q = raw.replace(/[(),.%'"\\]/g, ' ').trim().slice(0, 80)
  if (!q) return []
  const supabase = db2()
  const like = `%${q}%`
  const [m, s, t, n, tg] = await Promise.all([
    supabase.from('mistakes').select('id,title,content,cause,mistake_date').is('deleted_at', null)
      .or(`title.ilike.${like},content.ilike.${like},answer.ilike.${like},analysis.ilike.${like}`).limit(30),
    supabase.from('schedules').select('id,title,description,start_at,location').is('deleted_at', null)
      .or(`title.ilike.${like},description.ilike.${like},location.ilike.${like}`).limit(30),
    supabase.from('tasks').select('id,title,description,due_at').is('deleted_at', null)
      .or(`title.ilike.${like},description.ilike.${like}`).limit(30),
    supabase.from('notes').select('id,title,content,tags').is('deleted_at', null)
      .or(`title.ilike.${like},content.ilike.${like},summary.ilike.${like}`).limit(30),
    supabase.from('tags').select('id,name').ilike('name', like).limit(20)
  ])
  const hits: SearchHit[] = []
  ;(m.data || []).forEach((x: any) => hits.push({
    module: 'mistake', id: x.id, title: x.title,
    excerpt: stripHtml(x.content || '').slice(0, 90), href: `/mistakes/${x.id}`, extra: x.cause
  }))
  ;(s.data || []).forEach((x: any) => hits.push({
    module: 'schedule', id: x.id, title: x.title,
    excerpt: [x.location, x.description].filter(Boolean).join(' · ').slice(0, 90),
    href: '/calendar', extra: new Date(x.start_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }))
  ;(t.data || []).forEach((x: any) => hits.push({
    module: 'task', id: x.id, title: x.title,
    excerpt: stripHtml(x.description || '').slice(0, 90), href: '/tasks',
    extra: x.due_at ? `截止 ${new Date(x.due_at).toLocaleDateString('zh-CN')}` : undefined
  }))
  ;(n.data || []).forEach((x: any) => hits.push({
    module: 'note', id: x.id, title: x.title,
    excerpt: stripHtml(x.content || '').slice(0, 90), href: `/notes?edit=${x.id}`,
    extra: (x.tags || []).join(' #')
  }))
  ;(tg.data || []).forEach((x: any) => hits.push({
    module: 'tag', id: x.id, title: `#${x.name}`,
    excerpt: '标签 · 点击按该标签筛选题目', href: `/mistakes?tag=${encodeURIComponent(x.name)}`
  }))
  return hits
}

// ===========================================================================
// 首页聚合仪表盘（验收 9 / 第 7 段第三节 5）
// ===========================================================================
export async function overviewStats(): Promise<OverviewStats> {
  const supabase = db2()
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayEnd = new Date(dayStart.getTime() + 86400000)
  const weekStart = new Date(dayStart); weekStart.setDate(dayStart.getDate() - 7)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const [sch, tsk, due, habits, focus, all] = await Promise.all([
    listSchedules(dayStart.toISOString(), dayEnd.toISOString()),
    listTasks({ limit: 200 }),
    supabase.from('mistakes').select('id,title,subject_id,mastery,cause,next_review_at,created_at,subject:subjects(id,name),deleted_at')
      .is('deleted_at', null).lte('next_review_at', dayEnd.toISOString()).order('next_review_at').limit(100),
    listHabits(),
    listFocusSessions(500),
    supabase.from('mistakes').select('id,subject_id,subject:subjects(id,name),mastery,cause,knowledge_points,mistake_date,created_at,next_review_at,deleted_at')
      .is('deleted_at', null)
  ])

  const rows = (all.data || []) as unknown as Mistake[]
  const focusRows = focus || []
  const todayFocusMinutes = focusRows
    .filter((f) => new Date(f.started_at) >= dayStart && f.mode === 'focus')
    .reduce((a, f) => a + (f.duration_minutes || 0), 0)
  const weekFocusMinutes = focusRows
    .filter((f) => new Date(f.started_at) >= weekStart && f.mode === 'focus')
    .reduce((a, f) => a + (f.duration_minutes || 0), 0)

  return {
    todaySchedules: sch,
    todayTasks: tsk.filter((t) => !t.completed),
    dueMistakes: (due.data || []) as unknown as Mistake[],
    habits,
    habitDone: habits.filter((h) => h.checkedToday).length,
    todayFocusMinutes, weekFocusMinutes,
    total: rows.length,
    weekNew: rows.filter((r) => new Date(r.created_at) >= weekStart).length,
    monthNew: rows.filter((r) => new Date(r.created_at) >= monthStart).length,
    rows
  }
}
