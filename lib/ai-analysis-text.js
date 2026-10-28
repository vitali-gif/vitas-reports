/**
 * lib/ai-analysis-text.js — ניתוח AI כטקסט פשוט להעתקה (ויטלי, 28.10: "כפתור של העתקת הטקסט").
 *
 * מודול נפרד מ-lib/ai-analysis.js כדי שהדפדפן לא ימשוך את ה-SDK של Anthropic.
 * הכותרות מסומנות ב-*כוכביות* — בוואטסאפ הן יוצאות מודגשות, ובכל מקום אחר נשארות קריאות.
 */
import { periodLabel } from './report-pdf.js'

const OWNER = { agency: 'סוכנות', sales: 'צוות מכירות', client: 'לקוח' }
const CONF = { high: 'סביר מאוד', medium: 'אפשרי', low: 'השערה רחוקה' }
const clean = (s) => String(s ?? '').replace(/[—–]/g, '-').trim()

/** a: שורה מ-ai_analyses ({ period_key, compare_key, result }). project/client — לכותרת. */
export function analysisText(a, { project, client } = {}) {
  const r = a?.result || {}
  const lines = []
  const who = [client, project].filter(Boolean).join(' / ')
  const when = periodLabel(a?.period_key) + (a?.compare_key ? ` מול ${periodLabel(a.compare_key)}` : '')
  lines.push(`*${clean(who ? `${who} - ${when}` : when)}*`, '')
  if (r.headline) lines.push(`*${clean(r.headline)}*`)
  if (r.summary) lines.push(clean(r.summary))
  const block = (title, items, fmt) => {
    if (!items?.length) return
    lines.push('', `*${title}*`)
    items.forEach((x, i) => lines.push(fmt(x, i)))
  }
  block('מה השתנה', r.changes, x => `• ${clean(x.title)} - ${clean(x.detail)}`)
  block('הסברים אפשריים (השערות, לא הוכחה)', r.reasons, x => `• ${clean(x.title)} (${CONF[x.confidence] || x.confidence}) - ${clean(x.detail)}`)
  block('מה לעשות', r.actions, (x, i) => `${i + 1}. ${clean(x.title)} (${OWNER[x.owner] || x.owner}) - ${clean(x.detail)}`)
  block('מה לבדוק', r.watch, x => `• ${clean(x)}`)
  return lines.join('\n').trim()
}
