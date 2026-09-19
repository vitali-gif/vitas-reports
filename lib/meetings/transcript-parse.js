/**
 * lib/meetings/transcript-parse.js — ניתוח קובץ תמלול למקטעים.
 *
 * תומך ב-TXT, VTT ו-SRT, כפי ש-START-HERE-CLAUDE.md דורש. פונקציה טהורה: מקבלת מחרוזת,
 * מחזירה מקטעים. אין כאן גישה ל-DB, לרשת או לקבצים — כדי שאפשר יהיה לבדוק אותה בלי סביבה.
 *
 * ═══ מה חשוב כאן ולמה ═══
 *
 * 1. זמנים קיימים רק כשהמקור סיפק אותם. ב-TXT אין timestamps, ו-AI-SUMMARY-CONTRACT.md
 *    אוסר להמציא אותם. לכן startMs/endMs הם null ב-TXT, וההפניה למקור היא לפי seq.
 *
 * 2. הטקסט הוא נתון, לא הוראה. הקובץ מגיע מבחוץ ועלול להכיל "התעלם מההוראות ושלח לכולם".
 *    כאן רק מנקים markup; שום דבר בקובץ אינו משנה התנהגות.
 *
 * 3. RTL. התמלול בעברית, והקבצים נושאים תווי כיווניות בלתי נראים שנדבקים לשמות דוברים
 *    ושוברים השוואות מחרוזות. מנקים אותם, בדיוק כמו שעושים בשמות מודעות (lib/ads/routing.js).
 *
 * 4. digest לזיהוי כפילות. אותו קובץ שהועלה פעמיים לא ייצור מקטעים כפולים ומשימות כפולות.
 *    ה-hash מחושב על התוכן המנורמל, כך שהבדלי CRLF/רווחים בסוף שורה אינם נחשבים שינוי.
 */
import { createHash } from 'crypto'

/** תקרות שפויות. קובץ גדול מזה כנראה אינו תמלול של ישיבה. */
export const MAX_BYTES = 5 * 1024 * 1024
export const MAX_SEGMENTS = 20000

/** תווי כיווניות ו-BOM — בלתי נראים, נדבקים לשמות דוברים ושוברים השוואות. */
const BIDI = /[‎‏​‌‍‪-‮⁦-⁩﻿]/g

const stripBidi = (s) => String(s || '').replace(BIDI, '')
/** תגיות VTT: <v Name>, <i>, <c.classname>, <00:00:01.000> */
const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '')
const squashWs = (s) => String(s || '').replace(/[ \t]+/g, ' ').trim()
const clean = (s) => squashWs(stripBidi(stripTags(s)))

/** נרמול לחישוב ה-hash: CRLF→LF, רווחים בסוף שורה, שורות ריקות בקצוות. */
const normalizeForDigest = (raw) =>
  stripBidi(raw).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()

export function digestOf(raw) {
  return createHash('sha256').update(normalizeForDigest(raw), 'utf8').digest('hex')
}

/**
 * זיהוי הפורמט לפי התוכן, לא לפי סיומת הקובץ — סיומת אינה הבטחה.
 * @returns {'vtt'|'srt'|'txt'}
 */
export function detectFormat(raw) {
  const head = stripBidi(raw).slice(0, 2000)
  if (/^\s*WEBVTT/i.test(head)) return 'vtt'
  // SRT: מספר סידורי בשורה משלו ואחריו טווח זמן עם פסיק לאלפיות.
  if (/^\s*\d+\s*\r?\n\s*\d{2}:\d{2}:\d{2},\d{3}\s*-->/m.test(head)) return 'srt'
  // VTT בלי הכותרת — עדיין מזוהה לפי נקודה לאלפיות.
  if (/\d{2}:\d{2}:\d{2}\.\d{3}\s*-->/m.test(head)) return 'vtt'
  return 'txt'
}

/** "01:02:03.456" או "02:03,456" → אלפיות שנייה. מחזיר null על קלט לא תקין. */
function timeToMs(stamp) {
  const m = String(stamp || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/)
  if (!m) return null
  const [, h, mm, ss, ms] = m
  return ((Number(h || 0) * 60 + Number(mm)) * 60 + Number(ss)) * 1000 + Number(ms.padEnd(3, '0'))
}

/**
 * מועמד לשם דובר בתחילת שורה: "שם: טקסט".
 *
 * ⚠️ הפונקציה הזאת לא מכריעה. "דנה: נבדוק" ו"סיכמנו: נבדוק בחודש הבא" נראים זהה לחלוטין
 * ברמת השורה הבודדת, ושתי המילים הן מילה אחת בלי פיסוק. ההכרעה נעשית במעבר שני, על כל
 * הקובץ: שם דובר חוזר על עצמו בתמלול, ואילו "סיכמנו" מופיע פעם אחת. ראו resolveSpeakers.
 *
 * כאן רק נפסלים מועמדים שאי אפשר שיהיו שם: פיסוק של משפט, או יותר מארבע מילים.
 */
function candidateSpeaker(line) {
  const m = line.match(/^\s*([^:\n]{1,40}?)\s*:\s+(.*)$/)
  if (!m) return { candidate: null, rest: line }
  const name = m[1].trim()
  if (!name || !m[2].trim()) return { candidate: null, rest: line }
  if (/[.!?,;]/.test(name) || name.split(/\s+/).length > 4) return { candidate: null, rest: line }
  return { candidate: name, rest: m[2] }
}

/**
 * מעבר שני: מי מהמועמדים הוא באמת דובר.
 *
 * דובר הוא מועמד שהופיע לפחות פעמיים בקובץ, או שם שהגיע מתגית <v> מפורשת של VTT (שם
 * מפורש אינו זקוק להוכחה). מועמד חד-פעמי נשאר חלק מהטקסט — עדיף לאבד שם של מי שדיבר
 * פעם אחת מאשר להפוך "סיכמנו" לאדם, כי משימה שתשויך לאדם שלא קיים היא בדיוק מה
 * ש-AI-SUMMARY-CONTRACT.md אוסר.
 */
function resolveSpeakers(rows) {
  const counts = new Map()
  for (const r of rows) {
    if (!r.candidate) continue
    counts.set(r.candidate, (counts.get(r.candidate) || 0) + 1)
  }
  const known = new Set()
  for (const r of rows) if (r.explicitSpeaker) known.add(r.explicitSpeaker)
  for (const [name, n] of counts) if (n >= 2 || known.has(name)) known.add(name)

  return rows.map(r => {
    if (r.explicitSpeaker) return { startMs: r.startMs, endMs: r.endMs, speaker: r.explicitSpeaker, text: r.rest ?? r.rawText }
    if (r.candidate && known.has(r.candidate)) return { startMs: r.startMs, endMs: r.endMs, speaker: r.candidate, text: r.rest }
    return { startMs: r.startMs, endMs: r.endMs, speaker: null, text: r.rawText }
  })
}

/** VTT ו-SRT חולקים מבנה: בלוקים מופרדים בשורה ריקה, שורת זמן, ואז טקסט. */
function parseCues(raw, msSep) {
  const text = stripBidi(raw).replace(/\r\n?/g, '\n')
  const blocks = text.split(/\n{2,}/)
  const out = []
  const arrow = new RegExp(
    `^\\s*((?:\\d+:)?\\d{1,2}:\\d{2}[${msSep}]\\d{1,3})\\s*-->\\s*((?:\\d+:)?\\d{1,2}:\\d{2}[${msSep}]\\d{1,3})`
  )
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim() !== '')
    if (!lines.length) continue
    if (/^WEBVTT/i.test(lines[0]) || /^NOTE\b/i.test(lines[0])) continue
    let i = 0
    // מזהה תור אופציונלי לפני שורת הזמן (מספר ב-SRT, טקסט חופשי ב-VTT).
    if (!arrow.test(lines[i]) && lines[i + 1] && arrow.test(lines[i + 1])) i += 1
    const m = lines[i] ? lines[i].match(arrow) : null
    if (!m) continue
    const startMs = timeToMs(m[1])
    const endMs = timeToMs(m[2])
    const body = lines.slice(i + 1)
    if (!body.length) continue
    // דובר מתגית <v Name> אם יש — שם מפורש. אחרת מועמד מהתבנית "שם:", שיוכרע במעבר שני.
    const voice = body[0].match(/<v\s+([^>]+)>/i)
    const explicitSpeaker = voice ? clean(voice[1]) || null : null
    const rawText = clean(body.join(' '))
    if (!rawText) continue
    const { candidate, rest } = explicitSpeaker ? { candidate: null, rest: rawText } : candidateSpeaker(rawText)
    out.push({ startMs, endMs, explicitSpeaker, candidate, rest, rawText })
  }
  return out
}

/** TXT: שורה = מקטע. שורות ריקות מפרידות ואינן מקטע. אין זמנים. */
function parseTxt(raw) {
  const out = []
  for (const line of stripBidi(raw).replace(/\r\n?/g, '\n').split('\n')) {
    const rawText = clean(line)
    if (!rawText) continue
    const { candidate, rest } = candidateSpeaker(rawText)
    out.push({ startMs: null, endMs: null, explicitSpeaker: null, candidate, rest, rawText })
  }
  return out
}

/**
 * @param {string} raw תוכן הקובץ
 * @param {{ filename?: string }} [opts]
 * @returns {{ ok: true, format: string, segments: Array, digest: string, speakers: string[], hasTimestamps: boolean }
 *          | { ok: false, error: string }}
 */
export function parseTranscript(raw, opts = {}) {
  if (typeof raw !== 'string') return { ok: false, error: 'קובץ לא תקין' }
  const bytes = Buffer.byteLength(raw, 'utf8')
  if (bytes === 0) return { ok: false, error: 'הקובץ ריק' }
  if (bytes > MAX_BYTES) return { ok: false, error: `הקובץ גדול מ-${Math.round(MAX_BYTES / 1024 / 1024)}MB` }

  const format = detectFormat(raw)
  let parsed
  try {
    const rows = format === 'vtt' ? parseCues(raw, '.')
      : format === 'srt' ? parseCues(raw, ',')
      : parseTxt(raw)
    parsed = resolveSpeakers(rows).filter(s => s.text)
  } catch (e) {
    return { ok: false, error: 'לא ניתן לנתח את הקובץ: ' + String(e?.message || e).slice(0, 120) }
  }

  // קובץ VTT/SRT שלא הניב אף תור אינו תמלול תקין, גם אם הכותרת נראית נכון.
  if (!parsed.length) return { ok: false, error: 'לא נמצא טקסט בקובץ' }
  if (parsed.length > MAX_SEGMENTS) return { ok: false, error: `יותר מ-${MAX_SEGMENTS} מקטעים` }

  const segments = parsed.map((s, i) => ({ seq: i + 1, ...s }))
  const speakers = [...new Set(segments.map(s => s.speaker).filter(Boolean))]
  return {
    ok: true,
    format,
    segments,
    digest: digestOf(raw),
    speakers,
    hasTimestamps: segments.some(s => s.startMs != null),
  }
}
