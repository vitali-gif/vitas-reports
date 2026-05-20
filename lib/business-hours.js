// Business-hours calculation for Israeli work week.
// Working hours: Sun-Thu 09:00-19:00, Fri 09:00-13:00, Sat off, holidays off.
//
// All timestamps are interpreted in Israel time (Asia/Jerusalem, UTC+2/+3).
// BMBY returns dates as 'YYYY-MM-DD HH:MM:SS' WITHOUT timezone - we treat them
// as already in Israel time.

const WORK_START_HOUR = 9
const WORK_END_HOUR = 19
const FRIDAY_END_HOUR = 13

// Israeli legal holidays + intermediate days when most offices are closed.
// Format: YYYY-MM-DD. Add more as needed.
const HOLIDAYS = new Set([
  // === 2025 ===
  '2025-04-13', // פסח - יום ראשון
  '2025-04-19', // פסח - שביעי
  '2025-04-30', // יום הזיכרון
  '2025-05-01', // יום העצמאות (נדחה)
  '2025-06-02', // שבועות
  '2025-09-23', '2025-09-24', // ראש השנה
  '2025-10-02', // יום כיפור
  '2025-10-07', // סוכות
  '2025-10-14', // שמחת תורה
  // === 2026 ===
  '2026-04-02', // פסח - יום ראשון
  '2026-04-08', // פסח - שביעי
  '2026-04-21', // יום הזיכרון
  '2026-04-22', // יום העצמאות
  '2026-05-22', // שבועות
  '2026-09-12', '2026-09-13', // ראש השנה
  '2026-09-21', // יום כיפור
  '2026-09-26', // סוכות
  '2026-10-03', // שמחת תורה
])

// Returns [startHour, endHour] for the given Date, or null if no work that day.
function workingHoursForDay(date) {
  const dow = date.getDay() // 0=Sun ... 6=Sat
  if (dow === 6) return null // Saturday - closed
  // Format date as YYYY-MM-DD (local-time) for holiday lookup
  const ymd = date.getFullYear() + '-' +
              String(date.getMonth() + 1).padStart(2, '0') + '-' +
              String(date.getDate()).padStart(2, '0')
  if (HOLIDAYS.has(ymd)) return null
  if (dow === 5) return [WORK_START_HOUR, FRIDAY_END_HOUR] // Friday - half day
  return [WORK_START_HOUR, WORK_END_HOUR] // Sun-Thu
}

/**
 * Compute business-hours minutes between two timestamps (ms since epoch).
 * Treats time as already in Israel local time.
 */
export function businessMinutesBetween(startMs, endMs) {
  if (!startMs || !endMs || endMs <= startMs) return 0
  let total = 0
  // Iterate day by day from the start day to the end day
  const cursor = new Date(startMs)
  cursor.setHours(0, 0, 0, 0)
  const endDay = new Date(endMs)
  endDay.setHours(23, 59, 59, 999)
  let safety = 0
  while (cursor.getTime() <= endDay.getTime() && safety < 366) {
    safety++
    const range = workingHoursForDay(cursor)
    if (range) {
      const [sh, eh] = range
      const dayStart = new Date(cursor)
      dayStart.setHours(sh, 0, 0, 0)
      const dayEnd = new Date(cursor)
      dayEnd.setHours(eh, 0, 0, 0)
      const segStart = Math.max(startMs, dayStart.getTime())
      const segEnd = Math.min(endMs, dayEnd.getTime())
      if (segEnd > segStart) {
        total += (segEnd - segStart) / 60000
      }
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return Math.round(total)
}

// For tests/admin
export const _HOLIDAYS = HOLIDAYS
export const _WORK_HOURS = { WORK_START_HOUR, WORK_END_HOUR, FRIDAY_END_HOUR }
