/**
 * lib/onboarding-form.js — שאלון הקליטה ללקוח (ויטלי, 7.11; הטיוטה: docs/ONBOARDING-FORM.md).
 *
 * טהור — רץ גם בדפדפן (app/onboard/[token]) וגם בשרת (/api/public/onboarding-form):
 *   FORM          — החלקים והשאלות
 *   visible(q, a) — האם שאלה מוצגת (לפי סוג העסק או תשובה קודמת)
 *   cleanAnswers  — מסנן תשובות לשאלות מוכרות בלבד, ומקצר טקסטים (בשרת, לפני שמירה)
 *   progress      — כמה שאלות נענו מתוך המוצגות
 *   stepsFromAnswers — אילו שלבים ב"קליטת לקוחות" (lib/onboarding-steps.js) לסמן, ועם איזו הערה
 *
 * אין בשאלון סיסמאות או מפתחות: גישות נותנים בפלטפורמה עצמה, וכאן רק "בוצע".
 */

export const FORM_AUTHOR = 'שאלון ללקוח'   // updated_by של שלבים שסומנו מהשאלון — כדי לא לדרוס סימון ידני

const CONTACT_ROLES = ['בעל החברה / מאשר תקציב', 'מנהל השיווק', 'מנהל המכירות', 'איש מכירות', 'משרד מכירות / מתווכים',
  'מנהל ה-CRM / IT', 'מנהל האתר', 'משרד פרסום / סטודיו קריאייטיב', 'קניין מדיה לאופליין', 'יחסי ציבור',
  'סוכנות דיגיטל נוספת', 'מוקד טלפוני', 'הנהלת חשבונות', 'יועץ משפטי', 'אחר']

const RE = (a) => a.biz_type === 'נדל"ן'
const has = (a, k, v) => Array.isArray(a[k]) && a[k].includes(v)

export const FORM = [
  {
    key: 'business', title: 'על העסק והפרויקט',
    why: 'כדי שהמודעות, הדוחות והניתוח ידברו בשפה של העסק שלכם.',
    questions: [
      { key: 'project_name', label: 'שם הפרויקט / המותג', type: 'text', required: true },
      { key: 'biz_type', label: 'סוג העסק', type: 'one', required: true, options: ['נדל"ן', 'מכשיר רפואי / קוסמטי', 'רהיטים ועיצוב', 'אחר'] },
      { key: 'biz_type_other', label: 'איזה עסק?', type: 'text', when: (a) => a.biz_type === 'אחר' },
      { key: 'what', label: 'מה אתם מוכרים, במשפט אחד', type: 'text', required: true },
      { key: 'audience', label: 'מי הלקוח האידיאלי שלכם?', type: 'long', required: true },
      { key: 'property_types', label: 'אילו סוגי נכסים', type: 'many', when: RE, options: ['דירה רגילה', 'דירת גן', 'פנטהאוז', 'מיני פנטהאוז', 'מסחר', 'משרדים', 'אחר'] },
      { key: 'units_left', label: 'כמה יחידות נשארו למכירה, בערך', type: 'text', when: RE },
      { key: 'prices', label: 'טווח מחירים', type: 'text' },
      { key: 'competitors', label: 'מתחרים עיקריים', type: 'text' },
      { key: 'forbidden', label: 'מה אסור להגיד במודעות, או מה דורש אישור משפטי?', type: 'long' },
      { key: 'assets_link', label: 'קישור לתיקייה עם לוגו, הדמיות / צילומים ומחירון', type: 'text', placeholder: 'https://…' },
    ],
  },
  {
    key: 'contacts', title: 'אנשי קשר',
    why: 'שנדע למי לפנות בכל נושא — בלי לחפש. ממלאים רק את מי שיש אצלכם.',
    questions: [
      { key: 'contacts', label: 'אנשי הקשר', type: 'table', required: true, cols: [
        { key: 'role', label: 'תפקיד', type: 'one', options: CONTACT_ROLES },
        { key: 'name', label: 'שם' }, { key: 'phone', label: 'טלפון' }, { key: 'email', label: 'מייל' },
        { key: 'about', label: 'על מה פונים אליו' },
      ] },
    ],
  },
  {
    key: 'dashboard', title: 'גישה לדשבורד ודוחות',
    why: 'כל מי שצריך לראות את הנתונים נכנס עם המייל שלו.',
    questions: [
      { key: 'dash_users', label: 'מי יקבל גישה לדשבורד', type: 'table', required: true, cols: [{ key: 'name', label: 'שם' }, { key: 'email', label: 'מייל' }] },
      { key: 'report_weekly', label: 'מי יקבל את הדוח השבועי (שמות או מיילים)', type: 'text' },
      { key: 'report_monthly', label: 'מי יקבל את הדוח החודשי (שמות או מיילים)', type: 'text' },
    ],
  },
  {
    key: 'ads', title: 'פרסום דיגיטלי',
    why: 'כדי שכל שקל שמוצא על פרסום ייכנס לדוח, וכל ליד יקבל את המקור הנכון.',
    questions: [
      { key: 'channels', label: 'באילו ערוצים אתם מפרסמים היום?', type: 'many', required: true, options: ['פייסבוק ואינסטגרם', 'גוגל', 'טיקטוק', 'לינקדאין', 'טאבולה', 'אאוטבריין', 'יוטיוב', 'אחר', 'עוד לא מפרסמים'] },
      { key: 'meta_done', label: 'לתת ל-VITAS גישת שותף לחשבון המודעות במטא', type: 'done', when: (a) => has(a, 'channels', 'פייסבוק ואינסטגרם'),
        help: 'Business Settings ← Accounts ← Ad accounts ← בוחרים את החשבון ← Assign partner ← מזינים את מזהה ה-Business של VITAS (נשלח לכם בנפרד).' },
      { key: 'google_done', label: 'לאשר את בקשת הקישור מה-MCC של VITAS', type: 'done', when: (a) => has(a, 'channels', 'גוגל'),
        help: 'בחשבון גוגל אדס: Admin ← Access and security ← Managers ← לאשר את הבקשה מ-863-912-0262.' },
      { key: 'other_channels_done', label: 'גישה לחשבונות המודעות בערוצים הנוספים', type: 'done',
        when: (a) => ['טיקטוק', 'לינקדאין', 'טאבולה', 'אאוטבריין', 'יוטיוב'].some(c => has(a, 'channels', c)),
        help: 'נשלח לכם הוראה קצרה לכל ערוץ שסימנתם.' },
      { key: 'other_agencies', label: 'מישהו נוסף מפעיל עבורכם פרסום? (סוכנות, קמפיינר, משרד פרסום)', type: 'yesno' },
      { key: 'agencies', label: 'מי?', type: 'table', when: (a) => a.other_agencies === 'כן', cols: [
        { key: 'company', label: 'חברה' }, { key: 'name', label: 'איש קשר' }, { key: 'phone', label: 'טלפון' }, { key: 'email', label: 'מייל' }, { key: 'channels', label: 'אילו ערוצים' },
      ] },
    ],
  },
  {
    key: 'site', title: 'האתר והטפסים',
    why: 'שם הלידים נכנסים. צריך לוודא שכל טופס מעביר מאיזו מודעה הליד הגיע.',
    questions: [
      { key: 'pages', label: 'כתובת האתר ודפי הנחיתה', type: 'table', cols: [{ key: 'url', label: 'כתובת' }, { key: 'about', label: 'על מה הדף' }] },
      { key: 'site_platform', label: 'על איזו מערכת האתר?', type: 'one', options: ['וורדפרס', 'וויקס', 'אלמנטור', 'דף נחיתה (Lpage / Unbounce וכו\')', 'אחר', 'לא יודעים'] },
      { key: 'site_manager', label: 'מי מנהל את האתר?', type: 'text' },
      { key: 'lead_transfer', label: 'איך הלידים מהאתר עוברים ל-CRM?', type: 'one', options: ['זאפייר', 'מייק (Make)', 'חיבור ישיר', 'לא יודעים'] },
      { key: 'automation_done', label: 'לשתף איתנו גישה לזאפייר / מייק (או צילומי מסך של כל התרחישים)', type: 'done',
        when: (a) => ['זאפייר', 'מייק (Make)'].includes(a.lead_transfer) },
      { key: 'ga4', label: 'יש לכם Google Analytics (GA4) ו-Tag Manager?', type: 'one', options: ['כן', 'לא', 'לא יודעים'] },
      { key: 'ga4_done', label: 'הרשאת צפייה ל-GA4 ו-Tag Manager לחשבון של VITAS (רשות)', type: 'done', when: (a) => a.ga4 === 'כן' },
    ],
  },
  {
    key: 'crm', title: 'מערכת ה-CRM',
    why: 'משם מגיעים הפגישות, ההרשמות והעסקאות — מה שבאמת חשוב בדוח.',
    questions: [
      { key: 'crm', label: 'באיזו מערכת CRM אתם עובדים?', type: 'one', required: true, options: ['BMBY', 'פיירברי', 'Zoho', 'Salesforce', 'מנדיי', 'HubSpot', 'אחר', 'אין'] },
      { key: 'crm_other', label: 'איזו מערכת?', type: 'text', when: (a) => a.crm === 'אחר' },
      { key: 'crm_manager', label: 'מי מנהל את המערכת אצלכם?', type: 'text', when: (a) => a.crm && a.crm !== 'אין' },
      { key: 'crm_api', label: 'גישת API כלולה בחבילה שלכם?', type: 'one', options: ['כלולה', 'בתשלום', 'לא יודעים'], when: (a) => a.crm && a.crm !== 'אין' },
      { key: 'crm_fields', label: 'אילו מהשדות האלה כבר קיימים על כל ליד?', type: 'many', when: (a) => a.crm && a.crm !== 'אין',
        help: 'מה שלא קיים — נשלח לכם רשימה מוכנה איך לפתוח אותו במערכת שלכם.',
        options: ['מקור הגעה (רשימה קבועה)', 'utm_source / medium / campaign', 'utm_content / term', 'מזהה מודעה', 'gclid (גוגל)',
          'סטטוס ליד', 'סיבת אי-רלוונטיות / התנגדות', 'איש מכירות אחראי', 'תאריך וסטטוס פגישה', 'הרשמה / חוזה וסכום'] },
      { key: 'crm_key_done', label: 'ליצור מפתח / משתמש API לפי ההוראות למערכת שלכם', type: 'done', when: (a) => a.crm && a.crm !== 'אין',
        help: 'לא להדביק את המפתח כאן — נתאם איתכם העברה בטוחה.' },
    ],
  },
  {
    key: 'process', title: 'איך ליד מגיע ואיך מטפלים בו',
    why: 'כדי שהדוח יבדוק את מה שבאמת קורה — וכדי שנוכל להמליץ מה לשפר.',
    questions: [
      { key: 'lead_sources', label: 'כל הדרכים שבהן ליד נכנס', type: 'many', required: true,
        options: ['טופס לידים בפייסבוק', 'טופס באתר', 'שיחת טלפון', 'וואטסאפ', 'צ\'אט באתר', 'פורטל (יד2 / מדלן)', 'הפניה', 'מגיע למשרד', 'אחר'] },
      { key: 'who_answers', label: 'מי עונה לשיחות?', type: 'one', options: ['משרד המכירות', 'מוקד חיצוני', 'כל איש מכירות בנייד שלו', 'אחר'] },
      { key: 'call_tracking', label: 'יש מספרי טלפון ייעודיים לכל ערוץ (call tracking)?', type: 'yesno' },
      { key: 'first_call', label: 'תוך כמה זמן מתקשרים לליד חדש, בדרך כלל?', type: 'one', options: ['עד 5 דקות', 'עד שעה', 'באותו יום', 'למחרת', 'לא קבוע'] },
      { key: 'attempts', label: 'כמה ניסיונות עד שמוותרים?', type: 'text' },
      { key: 'flow', label: 'איך נראה התהליך מליד ועד עסקה? (שיחה, פגישה, הרשמה, חוזה…)', type: 'long' },
      { key: 'reps', label: 'אנשי המכירות', type: 'table', cols: [{ key: 'name', label: 'שם' }, { key: 'when', label: 'מתי מטפל (בוקר / ערב / סופ"ש)' }] },
      { key: 'chat', label: 'יש אצלכם…', type: 'many', options: ['וואטסאפ עסקי', 'בוט', 'צ\'אט באתר', 'אין'] },
    ],
  },
  {
    key: 'more', title: 'ערוצים נוספים',
    why: 'פורטל, דיוור או שלט יכולים להקפיץ לידים בשבוע מסוים — טוב לדעת, כדי לא לייחס את זה בטעות למודעות.',
    questions: [
      { key: 'portals', label: 'באילו פורטלים יש לכם מודעות?', type: 'many', when: RE, options: ['יד2', 'מדלן', 'הומלס', 'אחר', 'אין'] },
      { key: 'portal_costs', label: 'עלות חודשית לכל פורטל, בערך', type: 'table', when: (a) => RE(a) && Array.isArray(a.portals) && a.portals.some(p => p !== 'אין'),
        cols: [{ key: 'portal', label: 'פורטל' }, { key: 'cost', label: 'עלות בחודש' }] },
      { key: 'email_sms', label: 'שולחים דיוור במייל / SMS / וואטסאפ ללידים?', type: 'one', options: ['באופן קבוע', 'לפעמים', 'לא'] },
      { key: 'email_system', label: 'באיזו מערכת?', type: 'text', when: (a) => ['באופן קבוע', 'לפעמים'].includes(a.email_sms) },
      { key: 'offline', label: 'פעילות אופליין בחצי השנה הקרובה', type: 'many', options: ['שילוט', 'רדיו', 'טלוויזיה', 'עיתונות', 'כנס / אירוע', 'אין'] },
      { key: 'offline_plan', label: 'מתי ובכמה, בערך', type: 'table', when: (a) => Array.isArray(a.offline) && a.offline.some(o => o !== 'אין'),
        cols: [{ key: 'kind', label: 'סוג' }, { key: 'dates', label: 'תאריכים' }, { key: 'cost', label: 'עלות' }] },
    ],
  },
  {
    key: 'goals', title: 'יעדים',
    why: 'כדי שהדוח יגיד לכם בבירור אם אנחנו בכיוון.',
    questions: [
      { key: 'budget', label: 'תקציב פרסום חודשי, בערך', type: 'text' },
      { key: 'success', label: 'כמה לידים / פגישות / עסקאות בחודש תחשבו הצלחה?', type: 'text' },
      { key: 'target_cost', label: 'עלות לליד או לפגישה שאתם מצפים לה', type: 'text' },
      { key: 'wish', label: 'מה הכי חשוב לכם לראות בדשבורד?', type: 'long' },
    ],
  },
]

const ALL_Q = FORM.flatMap(s => s.questions)
const Q_BY_KEY = new Map(ALL_Q.map(q => [q.key, q]))

export const visible = (q, a) => !q.when || !!q.when(a || {})

const filled = (q, v) => {
  if (q.type === 'table') return Array.isArray(v) && v.some(r => r && Object.values(r).some(x => String(x || '').trim()))
  if (q.type === 'many') return Array.isArray(v) && v.length > 0
  if (q.type === 'done') return v === true
  return v != null && String(v).trim() !== ''
}
export const isFilled = (q, a) => filled(q, (a || {})[q.key])

/** { done, total } — שאלות שנענו מתוך המוצגות. "בוצע" נספר רק כשסומן. */
export function progress(a) {
  const qs = ALL_Q.filter(q => visible(q, a))
  return { done: qs.filter(q => isFilled(q, a)).length, total: qs.length }
}

const T = (v, n = 300) => String(v == null ? '' : v).slice(0, n).trim()
/** בשרת: רק שאלות מוכרות, בסוג הנכון ובאורך סביר. */
export function cleanAnswers(raw) {
  const out = {}
  for (const [k, v] of Object.entries(raw || {})) {
    const q = Q_BY_KEY.get(k); if (!q) continue
    if (q.type === 'table') {
      if (!Array.isArray(v)) continue
      const cols = new Set(q.cols.map(c => c.key))
      out[k] = v.slice(0, 40).map(r => Object.fromEntries(Object.entries(r || {}).filter(([c]) => cols.has(c)).map(([c, x]) => [c, T(x, 200)])))
    } else if (q.type === 'many') {
      if (Array.isArray(v)) out[k] = v.filter(x => q.options.includes(x))
    } else if (q.type === 'done') out[k] = v === true
    else if (q.type === 'one' || q.type === 'yesno') { const opts = q.type === 'yesno' ? ['כן', 'לא'] : q.options; if (opts.includes(v)) out[k] = v; else if (v === '' || v == null) out[k] = '' }
    else out[k] = T(v, q.type === 'long' ? 3000 : 300)
  }
  return out
}

/**
 * אילו שלבים בקליטה לסמן לפי התשובות: { [step]: { status: 'done'|'doing'|'na', note } }.
 * רק מה שאפשר לדעת מהשאלון; שלב שאין עליו מספיק — לא מופיע (ולא נוגעים בו).
 */
export function stepsFromAnswers(a) {
  a = a || {}
  const out = {}
  const set = (step, status, note) => { out[step] = { status, note: note ? ('מהשאלון: ' + note).slice(0, 500) : 'מהשאלון' } }
  const list = (v) => (Array.isArray(v) ? v.join(', ') : '')
  const rows = (v) => (Array.isArray(v) ? v.filter(r => r && Object.values(r).some(x => String(x || '').trim())) : [])
  if (a.what && a.audience) set('assets', 'done', [a.what, a.assets_link].filter(Boolean).join(' · '))
  if (rows(a.contacts).length) set('contacts', 'done', rows(a.contacts).map(r => [r.role, r.name].filter(Boolean).join(': ')).join(' · '))
  if (a.report_weekly || a.report_monthly) set('reports', 'done', [a.report_weekly && 'שבועי: ' + a.report_weekly, a.report_monthly && 'חודשי: ' + a.report_monthly].filter(Boolean).join(' · '))
  const ch = Array.isArray(a.channels) ? a.channels : null
  if (ch) {
    if (!ch.includes('פייסבוק ואינסטגרם')) set('meta_access', 'na', 'לא מפרסמים במטא')
    else if (a.meta_done) set('meta_access', 'doing', 'הלקוח סימן שנתן גישה — לוודא בדשבורד')
    if (!ch.includes('גוגל')) { set('google_access', 'na', 'לא מפרסמים בגוגל'); set('google_tracking', 'na', 'לא מפרסמים בגוגל') }
    else if (a.google_done) set('google_access', 'doing', 'הלקוח סימן שאישר את הקישור — לוודא בדשבורד')
    const more = ch.filter(c => ['טיקטוק', 'לינקדאין', 'טאבולה', 'אאוטבריין', 'יוטיוב'].includes(c))
    if (!more.length) set('social_more', 'na', 'אין ערוצים נוספים')
    else set('social_more', a.other_channels_done ? 'doing' : 'todo', more.join(', '))
  }
  if (a.other_agencies === 'לא') set('other_agencies', 'na', 'אין סוכנויות נוספות')
  else if (a.other_agencies === 'כן' && rows(a.agencies).length) set('other_agencies', 'done', rows(a.agencies).map(r => [r.company, r.name].filter(Boolean).join(' – ')).join(' · '))
  if (rows(a.pages).length) set('website', 'done', [a.site_platform, ...rows(a.pages).map(r => r.url)].filter(Boolean).join(' · '))
  if (a.lead_transfer === 'חיבור ישיר') set('automation', 'na', 'חיבור ישיר מהאתר ל-CRM')
  else if (['זאפייר', 'מייק (Make)'].includes(a.lead_transfer)) set('automation', a.automation_done ? 'doing' : 'todo', a.lead_transfer)
  if (a.ga4 === 'לא') set('ga4', 'na', 'אין GA4')
  else if (a.ga4 === 'כן' && a.ga4_done) set('ga4', 'doing', 'הלקוח סימן שנתן הרשאה')
  if (a.crm) {
    if (a.crm === 'אין') { for (const s of ['crm_which', 'crm_api', 'crm_fields', 'crm_key', 'crm_statuses', 'crm_objections']) set(s, 'na', 'אין CRM') }
    else {
      set('crm_which', 'done', [a.crm === 'אחר' ? a.crm_other : a.crm, a.crm_manager && 'מנהל: ' + a.crm_manager].filter(Boolean).join(' · '))
      if (a.crm_api && a.crm_api !== 'לא יודעים') set('crm_api', 'done', a.crm_api)
      if (Array.isArray(a.crm_fields)) {
        const all = Q_BY_KEY.get('crm_fields').options
        const missing = all.filter(f => !a.crm_fields.includes(f))
        set('crm_fields', missing.length ? 'doing' : 'done', missing.length ? 'חסרים: ' + missing.join(', ') : 'כל השדות קיימים')
      }
      if (a.crm_key_done) set('crm_key', 'doing', 'הלקוח סימן שיצר מפתח — לתאם העברה')
    }
  }
  if (Array.isArray(a.lead_sources) && a.lead_sources.length) set('lead_sources', 'done', list(a.lead_sources))
  if (a.flow) set('sales_flow', 'done', [a.first_call && 'שיחה ראשונה: ' + a.first_call, a.attempts && 'ניסיונות: ' + a.attempts].filter(Boolean).join(' · '))
  if (rows(a.reps).length) set('reps', 'done', rows(a.reps).map(r => r.name).filter(Boolean).join(', '))
  if (a.who_answers) set('phone', 'done', [a.who_answers, a.call_tracking && 'מספרי מעקב: ' + a.call_tracking].filter(Boolean).join(' · '))
  if (Array.isArray(a.chat) && a.chat.length) set('whatsapp', a.chat.includes('אין') ? 'na' : 'done', list(a.chat))
  if (a.biz_type && a.biz_type !== 'נדל"ן') set('portals', 'na', 'לא נדל"ן')
  else if (Array.isArray(a.portals) && a.portals.length) set('portals', a.portals.includes('אין') ? 'na' : 'done', list(a.portals))
  if (a.email_sms === 'לא') set('email_sms', 'na', 'אין דיוור')
  else if (a.email_sms) set('email_sms', 'done', [a.email_sms, a.email_system].filter(Boolean).join(' · '))
  if (Array.isArray(a.offline) && a.offline.length) set('offline', a.offline.includes('אין') ? 'na' : 'done', list(a.offline))
  if (a.budget || a.success || a.target_cost) set('goals', 'done', [a.budget && 'תקציב: ' + a.budget, a.success && 'הצלחה: ' + a.success, a.target_cost && 'יעד עלות: ' + a.target_cost].filter(Boolean).join(' · '))
  return out
}
