/**
 * lib/ai-analysis-text.js — ניתוח AI כטקסט להעתקה (ויטלי, 28.10).
 *
 *   analysisText  — הניתוח הפנימי כטקסט נקי, מוכן להדבקה: בלי סימני עיצוב, איכות הנתונים קודם.
 *   clientText    — ההודעה ללקוח (clientMessage): קצרה, מה קרה, מה המשמעות, הצעד הבא, מה עלינו
 *                   ומה עליכם. לקבוצת הוואטסאפ של הלקוח — לא העתק של הניתוח הפנימי.
 *
 * מודול נפרד מ-lib/ai-analysis.js כדי שהדפדפן לא ימשוך את ה-SDK של Anthropic.
 */
import { periodLabel } from './report-pdf.js'

const OWNER = { agency: 'סוכנות', sales: 'צוות מכירות', client: 'לקוח' }
const CONF = { high: 'סביר מאוד', medium: 'אפשרי', low: 'השערה רחוקה' }
const LEVEL = { good: 'הנתונים מספיקים לניתוח', partial: 'נתונים חלקיים - לקרוא בזהירות', insufficient: 'אין מספיק נתונים למסקנה' }
const clean = (s) => String(s ?? '').replace(/[—–]/g, '-').replace(/\*/g, '').trim()

/** איכות הנתונים: הרמה מהקוד (dataCheck) גוברת; ההערות — של הקוד ואז של המודל, בלי כפילויות. */
export function qualityOf(r) {
  const level = r?.dataCheck?.level || r?.dataQuality?.level || null
  const seen = new Set()
  const notes = [...(r?.dataCheck?.notes || []), ...(r?.dataQuality?.notes || [])]
    .map(clean).filter(n => n && !seen.has(n) && seen.add(n))
  return level ? { level, label: LEVEL[level] || level, notes } : null
}

/** a: שורה מ-ai_analyses ({ period_key, compare_key, result }). project/client — לכותרת. */
export function analysisText(a, { project, client } = {}) {
  const r = a?.result || {}
  const lines = []
  const who = [client, project].filter(Boolean).join(' / ')
  const when = periodLabel(a?.period_key) + (a?.compare_key ? ` מול ${periodLabel(a.compare_key)}` : '')
  lines.push(clean(who ? `${who} - ${when}` : when))
  const q = qualityOf(r)
  if (q && q.level !== 'good') {
    lines.push('', `איכות הנתונים: ${q.label}`)
    q.notes.forEach(n => lines.push(`- ${n}`))
  }
  lines.push('')
  if (r.headline) lines.push(clean(r.headline))
  if (r.summary) lines.push(clean(r.summary))
  const block = (title, items, fmt) => {
    if (!items?.length) return
    lines.push('', title)
    items.forEach((x, i) => lines.push(fmt(x, i)))
  }
  block('מה השתנה', r.changes, x => `- ${clean(x.title)}: ${clean(x.detail)}`)
  block('הסברים אפשריים (השערות, לא הוכחה)', r.reasons, x => `- ${clean(x.title)} (${CONF[x.confidence] || x.confidence}): ${clean(x.detail)}`)
  block('מה לעשות', r.actions, (x, i) => `${i + 1}. ${clean(x.title)} (${OWNER[x.owner] || x.owner}): ${clean(x.detail)}`)
  block('מה לבדוק', r.watch, x => `- ${clean(x)}`)
  return lines.join('\n').trim()
}

/** ההודעה ללקוח — null לניתוח ישן שאין בו clientMessage. */
export function clientText(a, { project } = {}) {
  const c = a?.result?.clientMessage
  if (!c) return null
  const lines = [clean(`עדכון ${project ? project + ' - ' : ''}${periodLabel(a.period_key)}`), '']
  if (c.whatHappened) lines.push(clean(c.whatHappened))
  if (c.meaning) lines.push('', clean(c.meaning))
  if (c.nextStep) lines.push('', 'הצעד הבא: ' + clean(c.nextStep))
  if (c.onUs?.length) { lines.push('', 'מה עלינו:'); c.onUs.forEach(x => lines.push(`- ${clean(x)}`)) }
  if (c.onYou?.length) { lines.push('', 'מה עליכם:'); c.onYou.forEach(x => lines.push(`- ${clean(x)}`)) }
  return lines.join('\n').trim()
}
