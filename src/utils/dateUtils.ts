/**
 * 本地时区日期工具。
 *
 * ⚠️ 绝不要用 `new Date().toISOString().slice(0, 10)` 取"今天"：
 * 那是 UTC 日期，东八区（UTC+8）早 6-9 点会落到**前一天**，
 * 而"我醒了"正是这个时段——跨夜两条记录会算出同一个日期，
 * 而 App 按 date 去重覆盖，导致前一夜数据被静默删除。
 */

/** 本地时区 YYYY-MM-DD */
export function toLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 本地时区 HH:MM */
export function toLocalTimeString(date: Date = new Date()): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
