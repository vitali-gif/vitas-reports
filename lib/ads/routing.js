/**
 * lib/ads/routing.js — איך שורת מודעה (Meta/Google) משויכת לפרויקט, וכללי הצורה של
 * הדוח. הועבר מ-meta/fetch ו-google/fetch כמו שהוא, כדי שהדוחות השמורים ושורות
 * הטווח המחושבות (lib/ads/range-rows.js) יתנהגו זהה. שלב 2 של docs/daily-ranges-plan.md.
 */

// KLOSS multi-agency attribution: rows are matched to the KLOSS project by ad-account + campaign-name
// keywords (its campaigns don't contain "kloss" in the agency accounts), and tagged by agency for the breakdown.
export const KLOSS_SOURCES = [
  { account: '295378394595304', agency: 'סיגאווי', any: ['leadg', 'leads'] },
  { account: '143725504579407', agency: 'VITAS', all: ['kloss'], any: ['leadg', 'leads'] },
]
export function klossAgencyOf(r) {
  const camp = (r && r.campaign || '').toLowerCase()
  const acct = String(r && r.account)
  const sc = KLOSS_SOURCES.find(s => s.account === acct
    && (!s.all || s.all.every(k => camp.includes(k)))
    && (!s.any || s.any.some(k => camp.includes(k))))
  return sc ? sc.agency : null
}

// KLOSS multi-agency (Google): both accounts hold Kloss campaigns mixed with sister brands
// (Zula / Novo). Match by customer + campaign contains 'kloss', tag by agency.
// ⚠️ שני החשבונות מחזיקים קמפיינים של KLOSS לצד מותגים אחיות (Zula / Novo),
// ולכן ההתאמה היא לפי מילות מפתח ולא "כל מה שבחשבון".
//
// ויטלי (21.9): בחשבון של סיגאווי שלושה קמפיינים פעילים, Search ו-PMax, ואחד
// מהם לא נתפס — שמו לא מכיל "kloss" ולא "p-max". לכן נוספה 'search'.
//
// ⚠️ 'search' היא מילה גנרית. אם ייפתח בחשבון הזה קמפיין Search של Zula או
// Novo, הוא ייספר ל-KLOSS. זו ההנחה שוויטלי אישר; אם היא תישבר, הדרך הנכונה
// היא לעבור לרשימת שמות מדויקים ולא למילות מפתח.
export const KLOSS_GOOGLE_SOURCES = [
  { customer: '9483793370', agency: 'סיגאווי', any: ['kloss', 'p-max', 'pmax', 'search'] },
  { customer: '4733225739', agency: 'VITAS', any: ['kloss'] },
]
export function klossGoogleAgencyOf(r) {
  return googleAgencyOf(KLOSS_GOOGLE_SOURCES, r)
}

/**
 * שיוך שורת Google לפרויקט כששם הקמפיין אינו מכיל את שם הפרויקט.
 *
 * ברירת המחדל ב-google/fetch היא `campaign.includes(שם הפרויקט)`. היא עובדת
 * ללקוח שקורא לקמפיינים שלו על שמו, ולא עובדת כשהקמפיין נקרא אחרת:
 *  • KLOSS — קמפיינים בשני חשבונות סוכנויות, חלקם בלי המילה "kloss".
 *  • שמי נדל"ן — הפרויקט נקרא "כלל הפרויקטים", והקמפיין "Shami | ...".
 *
 * המפתח הוא שם הפרויקט ב-lowercase ו-trim, בדיוק כמו ה-needle ב-fetch.
 * לקוח חדש = שורה אחת כאן, בלי לגעת ב-route.
 */
export const GOOGLE_PROJECT_SOURCES = {
  'kloss': KLOSS_GOOGLE_SOURCES,
  // שמי נדל"ן (ויטלי, 21.9). החשבון 271-360-5466 תחת ה-MCC 863-912-0262.
  //
  // בלי `any` בכוונה: זה חשבון הלקוח עצמו ולא חשבון סוכנות משותף, ולכן *כל*
  // קמפיין בו שייך לפרויקט. ארבעת הקמפיינים היום הם Shami, Kalisher, Sokolov
  // ו-HaZoarim — כלומר אין מילת מפתח אחת שמשותפת לכולם, ורשימת מילות מפתח
  // הייתה מפילה בשקט כל קמפיין חדש עם שם של פרויקט נוסף (שבאזי, בן דוד, צה"ל).
  //
  // ⚠️ אם יום אחד ייכנס לחשבון הזה מותג אחר, צריך להוסיף כאן `any` עם רשימת
  // מילות המפתח — אחרת הוא ייספר לשמי נדל"ן.
  'כלל הפרויקטים': [
    { customer: '2713605466', agency: 'VITAS' },
  ],
  // אקספו חיפה — אלפא יזמות ובנייה (ויטלי, 28.9). החשבון 911-317-8078 תחת אותו
  // MCC 863-912-0262 של שמי נדל"ן, ולכן אין צורך בחיבור OAuth חדש.
  //
  // כאן דווקא *כן* מילת מפתח: שם הפרויקט עברי ("אקספו חיפה") ושמות הקמפיינים
  // לטיניים (expo_pmax), ולכן התאמת ברירת המחדל לפי שם הפרויקט לא תופסת כלום.
  // ההוראה של ויטלי הייתה "קמפיינים שמכילים את המילה EXPO", וזה גם מה שמפריד בין
  // אקספו חיפה לפרויקט האחות "אלפא טק" שיושב באותו חשבון.
  'אקספו חיפה': [
    { customer: '9113178078', agency: 'VITAS', any: ['expo'] },
  ],
}

/**
 * אותו רעיון בדיוק בצד מטא: חשבון + מילות מפתח בשם הקמפיין.
 *
 * עד היום היו במטא רק שתי דרכים — `meta_account_id` על הפרויקט (כל החשבון שייך לו),
 * או שם הקמפיין מכיל את שם הפרויקט. אקספו חיפה לא נופל באף אחת מהן: שם הפרויקט עברי,
 * שמות הקמפיינים לטיניים, ובאותו חשבון של אלפא יושב גם "אלפא טק".
 *
 * המפתח הוא שם הפרויקט ב-lowercase ו-trim. `account` הוא מזהה חשבון המודעות.
 */
export const META_PROJECT_SOURCES = {
  // אלפא יזמות ובנייה (ויטלי, 28.9): "קמפיינים שמכילים את המילה EXPO".
  'אקספו חיפה': [
    { account: '1035178045330004', agency: 'VITAS', any: ['expo'] },
  ],
}
export function metaSourcesForProject(projectName) {
  return META_PROJECT_SOURCES[String(projectName || '').toLowerCase().trim()] || null
}
export function metaAgencyOf(sources, r) {
  const camp = (r && r.campaign || '').toLowerCase()
  const acct = String(r && r.account)
  const sc = (sources || []).find(s => s.account === acct
    && (!s.all || s.all.every(k => camp.includes(k)))
    && (!s.any || s.any.some(k => camp.includes(k))))
  return sc ? sc.agency : null
}

/** הכלל המשותף: התאמה לפי חשבון + מילת מפתח בשם הקמפיין. */
export function googleAgencyOf(sources, r) {
  const camp = (r && r.campaign || '').toLowerCase()
  const cust = String(r && r.account)
  const sc = (sources || []).find(s => s.customer === cust
    && (!s.all || s.all.every(k => camp.includes(k)))
    && (!s.any || s.any.some(k => camp.includes(k))))
  return sc ? sc.agency : null
}

/** כללי הניתוב של פרויקט, או null אם הוא משתמש בהתאמה לפי שם. */
export function googleSourcesForProject(projectName) {
  return GOOGLE_PROJECT_SOURCES[String(projectName || '').toLowerCase().trim()] || null
}

// ── פירוק פנימי לתת-פרויקטים לפי שם המודעה ────────────────────────────────────
// לקוח שמריץ קמפיין אחד לכל החשבון ומזהה את הבניין ברמת המודעה ("AD 1 | שם טוב | ...")
// לא ניתן לפילוח לפי שם קמפיין. `projects.sub_projects` מחזיק את רשימת השמות,
// וכאן כל שורה נופלת לדלי אחד לפי השם הראשון שנמצא בשם המודעה.
//
// למה נרמול: שמות מודעות במטא מכילים תווי כיווניות RTL בלתי נראים שנדבקים בין
// מילים עבריות, וגם גרשיים בצורות שונות. השוואת מחרוזות נאיבית נכשלת עליהם בשקט —
// וכשל שקט כאן נראה כמו "לפרויקט אין הוצאה", לא כמו באג. לכן גם דלי "ללא שיוך".
export function normAdText(s) {
  return String(s || '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/["'`\u05f3\u05f4\u2018\u2019\u201c\u201d]/g, '')
    .replace(/[\s\-_|/\\,.]+/g, ' ')
    .trim()
    .toLowerCase()
}

// התאמה מהשם הארוך לקצר: אחרת "שמי כללי" נבלע ע"י דלי בשם "שמי".
export function subProjectMatcher(names) {
  const list = (Array.isArray(names) ? names : [])
    .map(n => ({ name: String(n || '').trim(), key: normAdText(n) }))
    .filter(x => x.name && x.key)
    .sort((a, b) => b.key.length - a.key.length)
  if (!list.length) return null
  return (adName) => {
    const hay = normAdText(adName)
    if (!hay) return null
    for (const x of list) if (hay.includes(x.key)) return x.name
    return null
  }
}

// ── Slim `data` to ad-level — ש.ברוך projects ONLY (staged rollout) ────────────
// Collapse the per-ad×age×gender rows into one row per ad; the demographics live in
// summary.demographics. Other clients keep the full rows until this is proven.
export const SLIM_PROJECTS = ['hi park', 'once', 'rehavia', 'ismooth']
export function isSlimProject(project) {
  return SLIM_PROJECTS.includes(String(project?.name || '').toLowerCase().trim())
}

/** סכומים + יחסים נגזרים, בדיוק כמו computeTotals ב-google/fetch וכמו pt ב-meta/fetch. */
export function computeTotals(rows) {
  const t = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 }
  for (const r of rows) {
    t.spend += r.spend
    t.impressions += r.impressions
    t.reach += r.reach
    t.clicks += r.clicks
    t.leads += r.leads
  }
  t.cpl = t.leads > 0 ? t.spend / t.leads : 0
  t.cpc = t.clicks > 0 ? t.spend / t.clicks : 0
  t.cpm = t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0
  t.ctr = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0
  t.convRate = t.clicks > 0 ? (t.leads / t.clicks) * 100 : 0
  t.frequency = t.reach > 0 ? t.impressions / t.reach : 0
  return t
}

/**
 * מסנן "השורה שייכת לפרויקט" — אותם כללים כמו ב-meta/fetch ו-google/fetch:
 *   Meta:   meta_account_id על הפרויקט → לפי חשבון; KLOSS → לפי סוכנות; אחרת שם הקמפיין מכיל את שם הפרויקט.
 *   Google: KLOSS → לפי סוכנות; אחרת שם הקמפיין מכיל את שם הפרויקט.
 * מחזיר null אם לפרויקט אין שם (אז אין לו שורות).
 */
export function projectRowFilter(project, source) {
  const needle = String(project?.name || '').toLowerCase().trim()
  if (!needle) return null
  const isKloss = needle === 'kloss'
  if (source === 'facebook') {
    // כללי חשבון+מילת מפתח קודמים ל-meta_account_id: הם הצורה הצרה יותר, ופרויקט
    // שמוגדר כאן הוא בדיוק פרויקט שחולק חשבון עם פרויקט אחר.
    const _meta = metaSourcesForProject(project.name)
    if (_meta) return (x) => metaAgencyOf(_meta, x) !== null
    const _acct = (project.meta_account_id || '').toString().trim()
    if (_acct) return (x) => String(x.account || '') === _acct
    if (isKloss) return (x) => klossAgencyOf(x) !== null
    return (x) => (x.campaign || '').toLowerCase().includes(needle)
  }
  // אותם כללי ניתוב כמו ב-google/fetch, אחרת שורות הטווח היומי והדוח החודשי
  // מייצרים מספרים שונים לאותו לקוח.
  const _rules = googleSourcesForProject(project.name)
  if (_rules) return (x) => googleAgencyOf(_rules, x) !== null
  return (x) => (x.campaign || '').toLowerCase().includes(needle)
}
