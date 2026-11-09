// ============================================================
// 全站类型定义（与 supabase/schema.sql 一一对应）
// ============================================================

export type Mastery = 'unmastered' | 'fuzzy' | 'mastered'
export type ReviewResult = 'again' | 'fuzzy' | 'mastered'
export type Cause = '计算错误' | '概念不清' | '审题错误' | '公式记错' | '步骤遗漏' | '粗心' | '其他'
export type PrintVariant = 'student' | 'answer' | 'review' | 'cause'
/** v2 扩展：新增 AI 日程解析 / AI 笔记总结 / AI 规划（预留） */
export type AiKind = 'organize' | 'ocr' | 'similar' | 'batch' | 'schedule' | 'note' | 'plan'
export type AiCapability = AiKind

export const CAUSES: Cause[] = ['计算错误', '概念不清', '审题错误', '公式记错', '步骤遗漏', '粗心', '其他']
export const MASTERY_LABEL: Record<Mastery, string> = {
  unmastered: '未掌握', fuzzy: '模糊', mastered: '已掌握'
}
export const VARIANT_LABEL: Record<PrintVariant, string> = {
  student: '学生版', answer: '答案版', review: '复习版', cause: '错因复盘版'
}

export interface Profile {
  id: string
  display_name: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

/** AI 开关设置（跨设备同步，服务端以此为准） */
export interface UserSettings {
  user_id: string
  ai_enabled: boolean          // 总开关
  ai_organize: boolean         // 子开关
  ai_ocr: boolean
  ai_similar: boolean
  ai_batch: boolean
  ai_schedule_parse: boolean      // v2：AI 自然语言创建日程
  ai_note_summary: boolean        // v2：AI 笔记总结
  ai_plan: boolean                // v2：AI 规划（预留，默认关）
  ai_text_model: string
  ai_vision_model: string
  default_print_template_id: string | null
  review_intervals: number[]
  prompt_template: string
  backup_reminder_days: number
  reminder_enabled: boolean       // v2：日程提醒
  default_calendar_view: 'day' | 'week' | 'month'
  default_remind_minutes: number
  focus_minutes: number
  break_minutes: number
  created_at?: string
  updated_at?: string
}

export interface Subject {
  id: string
  user_id: string
  name: string
  color: string
  sort_order: number
  archived: boolean
  created_at: string
}

export interface MistakeBook {
  id: string
  user_id: string
  subject_id: string | null
  name: string
  description: string
  archived: boolean
  created_at: string
}

export interface Tag {
  id: string
  user_id: string
  name: string
  color: string
}

export interface MistakeImage {
  id: string
  user_id: string
  mistake_id: string | null
  /** 新建错题尚未保存时的临时实体 id，保存后回填 mistake_id */
  draft_id: string | null
  storage_path: string
  mime_type: string
  width: number | null
  height: number | null
  size_bytes: number | null
  original_size_bytes: number | null
  compressed_size_bytes: number | null
  /** original=整题原图 / cropped=手动裁剪图 / inline=富文本内嵌图 / thumbnail=缩略图 */
  image_role: ImageRole
  parent_image_id: string | null
  crop_rect: { x: number; y: number; w: number; h: number } | null
  thumbnail_path: string | null
  public_url: string | null
  is_original_backed_up: boolean
  original_backup_note: string | null
  ocr_job_id: string | null
  is_ai_description: boolean
  sort_order: number
  created_at: string
  /** 运行时签名 URL，不入库 */
  signedUrl?: string
  /** 缩略图运行时签名 URL，不入库 */
  thumbnailUrl?: string
}

export type ImageRole = 'original' | 'cropped' | 'inline' | 'thumbnail'

/** 服务端 /api/images/upload 的返回体 */
export interface UploadedImage {
  id: string
  storage_path: string
  signedUrl: string
  image_role: ImageRole
  parent_image_id: string | null
  crop_rect: MistakeImage['crop_rect']
  mime_type: string
  width: number | null
  height: number | null
  size_bytes: number
  original_size_bytes: number | null
  mistake_id: string | null
  draft_id: string | null
  thumbnail_path: string | null
}

/** 整题 OCR 结构化结果（AI 视觉模型或本地 OCR 都归一到这个结构） */
export interface FullPageOcrResult {
  text: string
  options: string
  formulas: string
  figureDescription: string
  /** AI 图形描述必须标注「AI 描述，仅供参考」，打印默认不输出 */
  isAiDescription: boolean
  confidence: number | null
  source: 'ai' | 'local'
  rawText: string
}

/** 整题上传预览工作区里的一张图 */
export interface CaptureItem {
  key: string
  image: UploadedImage
  text: string
  options: string
  formulas: string
  figureDescription: string
  ocrStatus: 'idle' | 'running' | 'succeeded' | 'failed' | 'skipped'
  ocrError: string
  ocrSource: 'ai' | 'local' | ''
  retryCount: number
  cropped: UploadedImage[]
}

/** 整题预览点「确认应用」后交回编辑页的内容 */
export interface CaptureApplyPayload {
  /** 已按用户选择拼好的 HTML（题干 / 选项 / 公式） */
  html: string
  targetField: 'content' | 'analysis'
  items: CaptureItem[]
  /** 原图 + 裁剪图，全部已在 Storage，等待保存时绑定到错题 */
  images: UploadedImage[]
}

export interface Mistake {
  id: string
  user_id: string
  book_id: string | null
  subject_id: string | null
  title: string
  content: string            // Tiptap HTML
  answer: string
  analysis: string
  knowledge_points: string[]
  cause: Cause
  difficulty: number
  source: string
  mastery: Mastery
  mistake_date: string        // YYYY-MM-DD
  created_at: string
  updated_at: string
  next_review_at: string
  review_interval_days: number
  review_count: number
  error_count: number
  deleted_at: string | null
  ai_result: AiOrganizeResult | null
  ai_applied_at: string | null
  similar_questions: string[]
  /** 联表结果 */
  images?: MistakeImage[]
  tags?: Tag[]
  subject?: Pick<Subject, 'id' | 'name' | 'color'> | null
  book?: Pick<MistakeBook, 'id' | 'name'> | null
}

export type MistakeInput = Partial<Omit<Mistake, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'images' | 'tags' | 'subject' | 'book'>>

export interface MistakeVersion {
  id: string
  mistake_id: string
  version_no: number
  snapshot: Record<string, unknown>
  change_note: string
  created_at: string
}

export interface ReviewLog {
  id: string
  user_id: string
  mistake_id: string
  result: ReviewResult
  note: string
  reviewed_at: string
  next_review_at: string | null
}

export interface PracticeLog {
  id: string
  user_id: string
  mistake_id: string
  paper_no: string | null
  result: ReviewResult
  note: string
  answered_at: string
}

export interface PrintOptions {
  showAnswer: boolean
  showAnalysis: boolean
  showKnowledge: boolean
  showTags: boolean
  showImages: boolean
  showCause: boolean
  showReviewAdvice: boolean
  showHeader: boolean
  /** v4：手动裁剪图是否打印（默认不打印，避免与整题原图重复） */
  showCroppedImages?: boolean
  /** v4：AI 图形描述默认不打印；勾选后才输出并保留「AI 描述，仅供参考」标注 */
  showAiFigureDescription?: boolean
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  showAnswer: true, showAnalysis: true, showKnowledge: true, showTags: true,
  showImages: true, showCause: true, showReviewAdvice: false, showHeader: true,
  showCroppedImages: false, showAiFigureDescription: false
}

export interface PrintTemplate {
  id: string
  user_id: string
  name: string
  variant: PrintVariant
  options: PrintOptions
  is_default: boolean
  created_at: string
}

export interface ShareLink {
  id: string
  user_id: string
  token: string
  scope: 'single' | 'book' | 'filter'
  target_id: string | null
  filter_json: Record<string, unknown>
  expires_at: string
  revoked: boolean
  view_count: number
  created_at: string
}

export interface AiOrganizeResult {
  normalizedStem: string
  knowledgePoints: string[]
  cause: Cause
  steps: string[]
  answerPoints: string[]
  tags: string[]
  difficulty: number
  reviewAdvice: string
  similarQuestions: string[]
}

export interface OcrResult {
  text: string
  formulas: string[]
  rawText?: string
}

export interface AiJob {
  id: string
  kind: AiKind
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  result_json: unknown
  error: string | null
  attempts: number
  created_at: string
}

export interface AiUsageLog {
  id: string
  kind: string
  model: string | null
  total_tokens: number
  quota_units: number
  status: string
  error_code: string | null
  created_at: string
}

/** /api/ai/status 返回：前端据此隐藏/置灰所有 AI 入口 */
export interface AiStatus {
  enabled: boolean                 // 总开关
  caps: Record<AiCapability, boolean>
  configured: boolean              // 服务端 Key / Base URL / 模型是否齐备
  configIssues: string[]           // 缺什么（不含密钥内容）
  textModel: string
  visionModel: string
  ocrModel: string
  baseUrl: string
  statusText: '已开启' | '已关闭' | 'AI未配置'
  usage: { calls: number; units: number }
}

export interface MistakeFilters {
  q?: string
  subject_id?: string
  book_id?: string
  tag_id?: string
  cause?: Cause | ''
  difficulty?: number | ''
  mastery?: Mastery | ''
  dateFrom?: string
  dateTo?: string
  dateBy?: 'mistake_date' | 'created_at' | 'next_review_at'
  sort?: 'newest' | 'oldest' | 'review' | 'errors'
  group?: 'none' | 'week' | 'month' | 'timeline' | 'calendar'
  page?: number
  pageSize?: number
  includeDeleted?: boolean
}

// ============================================================
// v2（第 7 段）：个人综合管理网站新增模块类型
// ============================================================

export type RepeatRule = 'none' | 'daily' | 'weekly' | 'monthly'
export type Priority = 1 | 2 | 3              // 1 高 / 2 中 / 3 低
export const PRIORITY_LABEL: Record<Priority, string> = { 1: '高', 2: '中', 3: '低' }
export const PRIORITY_COLOR: Record<Priority, string> = {
  1: 'bg-rose-50 text-rose-700 border-rose-200',
  2: 'bg-amber-50 text-amber-700 border-amber-200',
  3: 'bg-slate-50 text-slate-600 border-slate-200'
}
export const REPEAT_LABEL: Record<RepeatRule, string> = {
  none: '不重复', daily: '每天', weekly: '每周', monthly: '每月'
}
export const SCHEDULE_CATEGORIES = ['学习', '工作', '生活', '复习', '其他'] as const

export interface Schedule {
  id: string
  user_id: string
  title: string
  description: string
  start_at: string
  end_at: string | null
  all_day: boolean
  location: string
  category: string
  priority: Priority
  status: 'todo' | 'done' | 'cancelled'
  repeat_rule: RepeatRule
  remind_minutes: number
  mistake_id: string | null
  note_id: string | null
  task_id: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  /** 联表：关联错题标题，用于「点击跳转错题详情」 */
  mistake?: { id: string; title: string } | null
}
export type ScheduleInput = Partial<Omit<Schedule, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'mistake'>>

export interface ScheduleReminder {
  id: string
  user_id: string
  schedule_id: string
  remind_at: string
  channel: 'inapp' | 'email'
  sent: boolean
  created_at: string
}

export interface Task {
  id: string
  user_id: string
  title: string
  description: string
  priority: Priority
  due_at: string | null
  completed: boolean
  completed_at: string | null
  repeat_rule: RepeatRule
  schedule_id: string | null
  mistake_id: string | null
  focus_minutes: number
  tags: string[]
  deleted_at: string | null
  created_at: string
  updated_at: string
  subtasks?: Subtask[]
  mistake?: { id: string; title: string } | null
}
export type TaskInput = Partial<Omit<Task, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'subtasks' | 'mistake'>>

export interface Subtask {
  id: string
  user_id: string
  task_id: string
  title: string
  done: boolean
  sort_order: number
  created_at: string
}

export interface Note {
  id: string
  user_id: string
  title: string
  content: string
  tags: string[]
  mistake_id: string | null
  schedule_id: string | null
  summary: string
  deleted_at: string | null
  created_at: string
  updated_at: string
}
export type NoteInput = Partial<Omit<Note, 'id' | 'user_id' | 'created_at' | 'updated_at'>>

export interface NoteVersion {
  id: string
  note_id: string
  version_no: number
  snapshot: Record<string, unknown>
  change_note: string
  created_at: string
}

export interface Habit {
  id: string
  user_id: string
  name: string
  color: string
  icon: string
  target_per_week: number
  remind_at: string | null
  archived: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
  /** 运行时计算 */
  streak?: number
  checkedToday?: boolean
  /** 当月打卡日期（兼容首页/目标页统计） */
  monthLogs?: string[]
  /** 全部历史打卡日期（升序去重），补录历史日期后月视图与连续天数都基于它重算 */
  allLogs?: string[]
}
export type HabitInput = Partial<Omit<Habit, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'streak' | 'checkedToday' | 'monthLogs' | 'allLogs'>>

export interface HabitLog {
  id: string
  user_id: string
  habit_id: string
  log_date: string
  note: string
  created_at: string
}

export interface FocusSession {
  id: string
  user_id: string
  task_id: string | null
  mistake_id: string | null
  started_at: string
  ended_at: string | null
  duration_minutes: number
  mode: 'focus' | 'break'
  note: string
  created_at: string
  task?: { id: string; title: string } | null
  mistake?: { id: string; title: string } | null
}

export interface Goal {
  id: string
  user_id: string
  title: string
  description: string
  target_date: string | null
  status: 'active' | 'done' | 'paused'
  progress: number
  habit_id: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  milestones?: GoalMilestone[]
}
export type GoalInput = Partial<Omit<Goal, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'milestones'>>

export interface GoalMilestone {
  id: string
  user_id: string
  goal_id: string
  title: string
  done: boolean
  due_date: string | null
  sort_order: number
  created_at: string
}

export interface Attachment {
  id: string
  user_id: string
  entity_type: 'note' | 'schedule' | 'task' | 'goal' | 'habit' | 'mistake'
  entity_id: string
  storage_path: string
  mime_type: string
  size_bytes: number
  created_at: string
}

export type TrashEntityType = 'mistake' | 'schedule' | 'task' | 'note' | 'habit' | 'goal'
export interface TrashItem {
  id: string
  entity_type: TrashEntityType
  entity_id: string
  title: string
  deleted_at: string
  expires_at: string
}
export const TRASH_TYPE_LABEL: Record<TrashEntityType, string> = {
  mistake: '错题', schedule: '日程', task: '待办', note: '笔记', habit: '习惯', goal: '目标'
}

export type SearchModule = 'mistake' | 'schedule' | 'task' | 'note' | 'tag'
export interface SearchHit {
  module: SearchModule
  id: string
  title: string
  excerpt: string
  href: string
  extra?: string
}
export const SEARCH_MODULE_LABEL: Record<SearchModule, string> = {
  mistake: '错题', schedule: '日程', task: '待办', note: '笔记', tag: '标签'
}

/** AI 自然语言创建日程的预览结果（必须先预览确认再创建） */
export interface ScheduleParseResult {
  title: string
  start_at: string
  end_at: string | null
  all_day: boolean
  location: string
  category: string
  priority: Priority
  repeat_rule: RepeatRule
  notes: string
}

/** AI 笔记总结的预览结果（必须先预览确认再写入） */
export interface NoteSummaryResult {
  summary: string
  keyPoints: string[]
  tags: string[]
  reviewAdvice: string
}

/** 首页聚合仪表盘 */
export interface OverviewStats {
  todaySchedules: Schedule[]
  todayTasks: Task[]
  dueMistakes: Mistake[]
  habits: Habit[]
  habitDone: number
  todayFocusMinutes: number
  weekFocusMinutes: number
  total: number
  weekNew: number
  monthNew: number
  rows: Mistake[]
}
