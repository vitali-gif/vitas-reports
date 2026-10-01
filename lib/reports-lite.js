/**
 * lib/reports-lite.js — קיצוץ סיכומים ישנים באינדקס הקל של /api/reports/by-project (T2).
 */

// ── T2 (1.10.2026): סיכומים מלאים רק לתקופות שבאמת נפתחות ─────────────────────────────
// האינדקס הקל החזיר את הסיכום המלא של *כל* שורה — 76 שורות לפרויקט, 5.6MB ב-ONCE —
// בכל פתיחת פרויקט. רוב המשקל הוא רשימות (לידים בשם, מודעות פעילות, קבוצות נכסים) של
// חודשים ישנים וטווחים שעברו (ה"היום" של אתמול וכו'), שאף אחד לא פותח שוב. נמדד:
// ONCE 5.6→2.2MB, HI PARK 4.9→1.7MB, KLOSS 4.8→2.4MB.
// תקופה "עדכנית" (החודש, החודש הקודם, וכל טווח שמסתיים מאתמול והלאה) נשארת מלאה, כך
// שמה שנפתח כברירת מחדל לא משתנה בכלל. שורה ישנה מגיעה בלי השדות הכבדים ועם
// summaryLite: true, והדשבורד משלים אותה דרך dataForMonths כשבוחרים בה (loadMonthsData).
const HEAVY_SUMMARY_KEYS = ['namedLeads', 'activeAds', 'crmRepRows', 'adBreakdown', 'otherUnqualNotes', 'otherLossNotes']
export function liteSummary(summary) {
  if (!summary || typeof summary !== 'object') return summary
  const out = { ...summary }
  for (const k of HEAVY_SUMMARY_KEYS) delete out[k]
  // הסטטוס הנוכחי של כל קבוצת נכסים נקרא מכל החודשים (_agCur ב-admin/page.js) — נשאר, בלי הנכסים.
  if (Array.isArray(out.assetGroups)) out.assetGroups = out.assetGroups.map(g => ({ id: g?.id, status: g?.status }))
  return out
}
export function recentKeyTest(now = new Date()) {
  const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d)
  const today = ymd(now)
  const yesterday = ymd(new Date(now.getTime() - 864e5))
  const [y, m] = today.split('-').map(Number)
  const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  return (key) => {
    const k = String(key || '')
    if (k.includes('_')) return k.split('_')[1] >= yesterday
    if (/^\d{4}-\d{2}$/.test(k)) return k >= prevMonth
    return true   // מפתח לא מוכר — לא מקצצים
  }
}
