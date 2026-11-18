/**
 * lib/tour-insights.js — "3 דברים שכדאי לראות" (ויטלי, 14.11): סיור קצר לכל פרויקט, מהמספרים שלו.
 *
 * המטרה: להביא את הלקוח לחלקים בדשבורד שהוא לא פותח (CRM, זמני תגובה, רשימות לידים), עם ממצא
 * אמיתי מהתקופה שעל המסך. הכללים כאן בלבד, כפונקציה טהורה — הרכיב (ProjectTour) רק מציג ומנווט.
 *
 * כל צעד: { id, stat, title, text, todo, go: { tab, crmSub?, card?, section? }, weight }
 *   go.card    — תווית כרטיס בראש הטאב: לוחצים עליו, ונפתחת רשימת הלידים.
 *   go.section — טקסט שמופיע בכותרת (h2) של החלק: גוללים אליו ומדגישים.
 * בלי שמות אנשים: רק מספרים ברמת הצוות (ההשוואה בין נציגים נשארת בטאב, למנהל).
 */

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const sum = (o) => Object.values(o || {}).reduce((s, v) => s + n(v), 0)
const fmt = (v) => n(v).toLocaleString('he-IL')

/** דלי "עד רבע שעה" מתוך דליי זמני התגובה, לפי סוג ה-CRM. null = אין מספיק נתונים. */
function responseFact(s, crmType) {
  if (crmType === 'salesforce') {
    const rt = s.responseTime || {}
    const measured = n(rt.measured), fast = n(rt.within1h)
    if (measured < 20) return null
    return { fast, total: measured, window: 'תוך שעה', share: fast / measured }
  }
  const biz = crmType !== 'zoho' && s.responseTimeStats?.business?.buckets
  const b = crmType === 'zoho' ? s.responseTime?.buckets : (biz || s.responseTimeStats?.buckets)
  if (!b) return null
  const total = sum(b), fast = n(b['0-15m'])
  if (total < 10) return null
  const slow = n(b['8h-1d']) + n(b['8h-24h']) + n(b['1d-3d']) + n(b['3d+'])
  return { fast, total, slow, slowLabel: biz ? '8 שעות עבודה' : '8 שעות', window: 'תוך רבע שעה', share: fast / total }
}

/**
 * @param {object} p
 * @param {object|null} p.crm     summary של שורת ה-CRM בתקופה
 * @param {boolean}     p.hasTikTok
 * @param {number}      [p.max=3]
 * @returns {Array} הצעדים, החשוב ביותר קודם
 */
export function tourSteps({ crm, hasTikTok = false, max = 3 } = {}) {
  const s = crm || {}
  const crmType = s.crmType || (s.namedLeads || s.responseTimeStats ? 'bmby' : null)
  const steps = []
  const leads = n(s.totalLeads)

  // 1. לידים שעוד לא טופלו (BMBY / Fireberry)
  if (['bmby', 'fireberry'].includes(crmType) && n(s.leadsToHandle) > 0) {
    const w = n(s.leadsToHandle)
    steps.push({ id: 'waiting', stat: fmt(w), title: 'לידים שמחכים לטיפול',
      text: `${fmt(w)} לידים מהתקופה עדיין בסטטוס "חדש" ב-CRM.`,
      todo: 'לחיצה על הכרטיס פותחת את הרשימה, ואפשר להעתיק אותה ישר לוואטסאפ של הצוות.',
      go: { tab: 'all', card: 'ממתינים לטיפול ב-CRM' }, weight: 60 + Math.min(30, (w / Math.max(leads, 1)) * 100) })
  }

  // 2. מהירות מענה
  const rf = responseFact(s, crmType)
  if (rf && rf.share < 0.3) {
    steps.push({ id: 'response', stat: `${fmt(rf.fast)}/${fmt(rf.total)}`, title: 'מהירות המענה ללידים',
      text: `רק ${fmt(rf.fast)} מתוך ${fmt(rf.total)} לידים קיבלו מענה ${rf.window}` + (rf.slow ? `, ו-${fmt(rf.slow)} חיכו יותר מ-${rf.slowLabel}.` : '.'),
      todo: 'בזמני תגובה רואים באילו שעות לידים מחכים הכי הרבה, ומה קורה ללידים שנענים מהר.',
      go: crmType === 'salesforce' ? { tab: 'crm', sfTab: 'timing', section: 'זמן טיפול בליד' }
        : crmType === 'zoho' ? { tab: 'crm', section: 'ביצועי אנשי מכירות' }
        : { tab: 'crm', crmSub: 'response', section: 'זמני תגובה' },
      weight: 55 + (0.3 - rf.share) * 100 })
  }

  // 3. פגישות שבוטלו
  const ms = n(s.meetingsScheduled), mc = n(s.meetingsCancelled)
  if (['bmby', 'fireberry'].includes(crmType) && ms >= 5 && mc / ms >= 0.2) {
    steps.push({ id: 'cancelled', stat: `${fmt(mc)}/${fmt(ms)}`, title: 'פגישות שבוטלו',
      text: `${fmt(mc)} מתוך ${fmt(ms)} פגישות שתואמו בתקופה בוטלו.`,
      todo: 'לחיצה על הכרטיס פותחת את רשימת הפגישות שבוטלו. כדאי לבדוק אם יש סיבה משותפת.',
      go: { tab: 'all', card: 'פגישות שבוטלו' }, weight: 45 + (mc / ms) * 60 })
  }

  // 4. לידים לא רלוונטיים
  const rel = n(s.relevantLeads)
  if (leads >= 20 && rel > 0 && rel / leads < 0.4) {
    steps.push({ id: 'relevance', stat: `${Math.round((rel / leads) * 100)}%`, title: 'כמה מהלידים רלוונטיים',
      text: `רק ${fmt(rel)} מתוך ${fmt(leads)} לידים סומנו כרלוונטיים.`,
      todo: 'במקורות הגעה רואים מאיזה מקור מגיעים הלידים הלא רלוונטיים.',
      go: { tab: 'crm', crmSub: 'sources', section: 'מקור' }, weight: 40 + (0.4 - rel / leads) * 100 })
  }

  // 5. שעת השיא של הלידים מחוץ לשעות העבודה
  const hl = Array.isArray(s.hourlyLeadStats) ? s.hourlyLeadStats.map(n) : null
  if (hl && hl.length === 24) {
    const max = Math.max(...hl), h = hl.indexOf(max)
    if (max >= 5 && (h >= 19 || h < 8)) {
      steps.push({ id: 'peakhour', stat: `${String(h).padStart(2, '0')}:00`, title: 'מתי נכנסים הכי הרבה לידים',
        text: `השעה עם הכי הרבה לידים היא ${String(h).padStart(2, '0')}:00, מחוץ לשעות העבודה (${fmt(max)} לידים).`,
        todo: 'כדאי לוודא שמישהו חוזר ללידים של הערב כבר בתחילת הבוקר.',
        go: { tab: 'crm', crmSub: 'response', section: 'שעות טיפול' }, weight: 35 + max })
    }
  }

  // 6. Zoho: מכשיר לא הוצע (18.11: החלק "הצעת מכשיר" נוסף לטאב ה-CRM של Zoho)
  if (crmType === 'zoho' && s.devices) {
    const t = sum(s.devices), no = n(s.devices['לא הוצע']) + n(s.devices['לא הוצע מכשיר'])
    if (t >= 20 && no / t > 0.8) {
      steps.push({ id: 'devices', stat: `${Math.round((no / t) * 100)}%`, title: 'הצעת מכשיר',
        text: `ב-${fmt(no)} מתוך ${fmt(t)} לידים מסומן שלא הוצע מכשיר.`,
        todo: 'אם זה רישום חסר ולא מצב אמיתי, כדאי לבקש מהצוות למלא את השדה. כך נדע מה באמת נמכר.',
        go: { tab: 'crm', section: 'הצעת מכשיר' }, weight: 50 })
    }
  }

  // 6b. Salesforce: הצעות מחיר שלא נסגרו (לידי התקופה) + פער בין סניפים
  if (crmType === 'salesforce') {
    const fc = s.funnelCohort || {}
    const q = n(fc.quotes), paid = n(fc.paid)
    if (q >= 10 && paid / q < 0.4) {
      steps.push({ id: 'quotes', stat: `${fmt(paid)}/${fmt(q)}`, title: 'הצעות מחיר שלא נסגרו',
        text: `מתוך ${fmt(q)} הצעות מחיר ללידים של התקופה, ${fmt(paid)} הגיעו לתשלום (${Math.round((paid / q) * 100)}%).`,
        todo: 'שווה לבדוק אם יש מעקב טלפוני אחרי הצעת מחיר, ותוך כמה ימים.',
        go: { tab: 'crm', sfTab: 'network', section: 'מה קרה ללידים' }, weight: 48 + (0.4 - paid / q) * 50 })
    }
    const br = Object.entries(s.byBranch || {}).filter(([k, v]) => k && k !== 'לא ידוע' && n(v.leads) >= 20)
      .map(([k, v]) => ({ k, rate: n(v.opportunities) / n(v.leads) }))
      .filter(x => x.rate <= 1)   // הזדמנויות של לידים ותיקים יכולות לעבור את מספר הלידים — סניף כזה לא בר השוואה
      .sort((a, b) => b.rate - a.rate)
    if (br.length >= 2 && br[0].rate - br[br.length - 1].rate >= 0.2) {
      const hi = br[0], lo = br[br.length - 1], pc = (x) => Math.round(x * 100) + '%'
      steps.push({ id: 'branches', stat: `${pc(hi.rate)}↔${pc(lo.rate)}`, title: 'הפער בין הסניפים',
        text: `בסניף ${hi.k} ${pc(hi.rate)} מהלידים הפכו להזדמנות, ובסניף ${lo.k} ${pc(lo.rate)}.`,
        todo: 'כדאי לבדוק מה עושים אחרת בסניף המוביל, ולהעביר את זה לשאר.',
        go: { tab: 'crm', sfTab: 'branches', section: 'השוואת סניפים' }, weight: 36 + (hi.rate - lo.rate) * 40 })
    }
  }

  // 6c. BMBY / Fireberry: המקור שהביא הכי הרבה פגישות
  if (['bmby', 'fireberry'].includes(crmType) && s.sources && typeof s.sources === 'object') {
    const best = Object.entries(s.sources).map(([k, v]) => ({ k, m: n(v?.meetingsScheduled), l: n(v?.totalLeads) }))
      .filter(x => x.k && x.m > 0).sort((a, b) => b.m - a.m)[0]
    const totalM = Object.values(s.sources).reduce((a, v) => a + n(v?.meetingsScheduled), 0)
    if (best && best.m >= 3 && totalM > 0) {
      steps.push({ id: 'bestsource', stat: fmt(best.m), title: 'מאיפה מגיעות הפגישות',
        text: `המקור שהביא הכי הרבה פגישות: "${best.k}" (${fmt(best.m)} מתוך ${fmt(totalM)} פגישות` + (best.l ? `, מ-${fmt(best.l)} לידים).` : ').'),
        todo: 'במקורות הגעה רואים לכל מקור כמה לידים, כמה פגישות וכמה הרשמות.',
        go: { tab: 'crm', crmSub: 'sources', section: 'מקור' }, weight: 34 })
    }
  }

  // 7. ההתנגדות / סיבת ההפסד המובילה
  const top = crmType === 'salesforce'
    ? (Array.isArray(s.lossReasons) && s.lossReasons[0] ? { reason: s.lossReasons[0].reason, count: n(s.lossReasons[0].count), total: n(s.lossTotal) || s.lossReasons.reduce((a, r) => a + n(r.count), 0) } : null)
    : (s.objections && typeof s.objections === 'object' && !Array.isArray(s.objections)
      ? (() => { const e = Object.entries(s.objections).filter(([k]) => k && k !== 'אחר').sort((a, b) => n(b[1]) - n(a[1]))[0]; return e ? { reason: e[0], count: n(e[1]), total: sum(s.objections) } : null })()
      : null)
  if (top && top.count >= 3) {
    steps.push({ id: 'objection', stat: fmt(top.count), title: crmType === 'salesforce' ? 'למה עסקאות לא נסגרות' : 'ההתנגדות הנפוצה',
      text: `${crmType === 'salesforce' ? 'הסיבה המובילה לעסקה שלא נסגרה' : 'ההתנגדות הנפוצה ביותר'}: "${top.reason}" (${fmt(top.count)} מתוך ${fmt(top.total)}).`,
      todo: 'שווה לבנות לצוות תשובה מוכנה להתנגדות הזו.',
      go: crmType === 'salesforce' ? { tab: 'crm', sfTab: 'branches', section: 'נשירת הזדמנות' } : crmType === 'zoho' ? { tab: 'crm', section: 'התנגדויות' } : { tab: 'crm', crmSub: 'objections' },
      weight: 30 + Math.min(20, top.count) })
  }

  steps.sort((a, b) => b.weight - a.weight)
  const out = steps.slice(0, max)
  // מעט ממצאים — משלימים בכלי שכמעט אף לקוח לא מכיר
  if (out.length < max) out.push({ id: 'compare', stat: '±%', title: 'השוואה לתקופה קודמת',
    text: 'מתג "השוואה לאותה תקופה" מראה ליד כל מספר אם עלה או ירד מול התקופה הקודמת.',
    todo: 'מפעילים אותו בראש המסך, ליד בחירת התקופה.',
    go: { tab: 'all', compare: true }, weight: 0 })
  // 8. ניסוי A/B בטיקטוק — צעד נוסף בסוף כשיש הוצאה בטיקטוק (18.11: לא נדחק החוצה ע"י ממצאי ה-CRM)
  if (hasTikTok) out.push({ id: 'tiktok', stat: 'A/B', title: 'ניסוי דף נחיתה מול טופס מיידי',
    text: 'בטאב TikTok רואים איזו גרסה מביאה לידים זולים יותר, ואיזו מביאה פגישות.',
    todo: 'שווה לבדוק פעם בשבוע עד סוף הניסוי.',
    go: { tab: 'tiktok', section: 'ניסוי A/B' }, weight: 0 })
  return out
}
