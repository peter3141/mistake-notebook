/** 与 supabase/schema.sql 中 user_settings 默认值保持一致 */
export const DEFAULT_PROMPT_TEMPLATE = '你是一位严谨的学科老师。请把下面这道错题整理成结构化 JSON，字段：normalizedStem(string)、knowledgePoints(string[])、cause(string，取值仅限：计算错误/概念不清/审题错误/公式记错/步骤遗漏/粗心/其他)、steps(string[])、answerPoints(string[])、tags(string[])、difficulty(1-5整数)、reviewAdvice(string)、similarQuestions(string[])。只输出 JSON，不要解释。'

export const DEFAULT_REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30]

export const DEFAULT_SETTINGS_ROW = {
  ai_enabled: false,
  ai_organize: true,
  ai_ocr: true,
  ai_similar: true,
  ai_batch: true,
  ai_schedule_parse: true,
  ai_note_summary: true,
  ai_plan: false,
  ai_textbook_quiz: false,
  ai_text_model: 'qwen3.7-plus',
  ai_vision_model: 'qwen3.7-plus',
  review_intervals: DEFAULT_REVIEW_INTERVALS,
  prompt_template: DEFAULT_PROMPT_TEMPLATE,
  backup_reminder_days: 30,
  default_print_template_id: null,
  reminder_enabled: true,
  default_calendar_view: 'month',
  default_remind_minutes: 15,
  focus_minutes: 25,
  break_minutes: 5
}
