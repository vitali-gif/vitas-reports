/**
 * lib/onboarding-form.js - שאלון הקליטה ללקוח (ויטלי, 7.11; הטיוטה: docs/ONBOARDING-FORM.md).
 *
 * טהור - רץ גם בדפדפן (app/onboard/[token]) וגם בשרת (/api/public/onboarding-form):
 *   FORM          - החלקים והשאלות
 *   visible(q, a) - האם שאלה מוצגת (לפי סוג העסק או תשובה קודמת)
 *   cleanAnswers  - מסנן תשובות לשאלות מוכרות בלבד, ומקצר טקסטים (בשרת, לפני שמירה)
 *   progress      - כמה שאלות נענו מתוך המוצגות
 *   stepsFromAnswers - אילו שלבים ב"קליטת לקוחות" (lib/onboarding-steps.js) לסמן, ועם איזו הערה
 *
 * אין בשאלון סיסמאות או מפתחות: גישות נותנים בפלטפורמה עצמה, וכאן רק "בוצע".
 */

export const FORM_AUTHOR = 'שאלון ללקוח'   // updated_by של שלבים שסומנו מהשאלון - כדי לא לדרוס סימון ידני

const CONTACT_ROLES = ['בעל החברה / מאשר תקציב', 'מנהל השיווק', 'מנהל המכירות', 'איש מכירות', 'משרד מכירות / מתווכים',
  'מנהל ה-CRM / IT', 'מנהל האתר', 'משרד פרסום / סטודיו קריאייטיב', 'קניין מדיה לאופליין', 'יחסי ציבור',
  'סוכנות דיגיטל נוספת', 'מוקד טלפוני', 'הנהלת חשבונות', 'יועץ משפטי', 'אחר']

const RE = (a) => a.biz_type === 'נדל"ן'

// הפרטים של VITAS שמופיעים בהודעת הגישות (ויטלי, 7.11)
export const AGENCY = {
  name: 'VITAS',
  metaBusinessId: '2220080831427169',   // Business Manager "Vitas - Campaign Manager" - שם משתמש המערכת של הדשבורד
  googleMcc: '863-912-0262',
  email: 'vitali@vitas.co.il',
}
const ASSET_LABEL = {
  'נדל"ן': 'קבצים: לוגו, הדמיות, צילומים ומחירון',
  'מכשיר רפואי / קוסמטי': 'קבצים: לוגו, תמונות של המוצר, אישורים ותוכן שיווקי',
  'רהיטים ועיצוב': 'קבצים: לוגו, קטלוג וצילומי פרויקטים',
  'חנות אונליין (איקומרס)': 'קבצים: לוגו, צילומי מוצרים וקטלוג',
}
// חנות אונליין (WANZOO, 7.11): המטרה מכירה ולא ליד - אין "איך מטפלים בליד", יש החנות, ההזמנות והמוצרים
export const ECOM_TYPE = 'חנות אונליין (איקומרס)'
const ECOM = (a) => a.biz_type === ECOM_TYPE
const LEADS = (a) => !ECOM(a)
const has = (a, k, v) => Array.isArray(a[k]) && a[k].includes(v)

export const FORM = [
  {
    key: 'business', title: 'על העסק והפרויקט',
    why: 'כדי שהמודעות, הדוחות והניתוח ידברו בשפה של העסק שלכם.',
    questions: [
      { key: 'project_name', label: 'שם הפרויקט / המותג', type: 'text', required: true },
      { key: 'biz_type', label: 'סוג העסק', type: 'one', required: true, options: ['נדל"ן', 'מכשיר רפואי / קוסמטי', 'רהיטים ועיצוב', ECOM_TYPE, 'אחר'] },
      { key: 'biz_type_other', label: 'איזה עסק?', type: 'text', when: (a) => a.biz_type === 'אחר' },
      { key: 'what', label: 'מה אתם מוכרים, במשפט אחד', type: 'text', required: true },
      { key: 'audience', label: 'מי הלקוח האידיאלי שלכם?', type: 'long', required: true },
      { key: 'property_types', label: 'אילו סוגי נכסים', type: 'many', when: RE, options: ['דירה רגילה', 'דירת גן', 'פנטהאוז', 'מיני פנטהאוז', 'מסחר', 'משרדים', 'אחר'] },
      { key: 'units_left', label: 'כמה יחידות נשארו למכירה, בערך', type: 'text', when: RE },
      { key: 'prices', label: 'טווח מחירים', type: 'text' },
      { key: 'competitors', label: 'מתחרים עיקריים', type: 'text' },
      { key: 'forbidden', label: 'מה אסור להגיד במודעות, או מה דורש אישור משפטי?', type: 'long' },
      { key: 'assets_files', label: (a) => ASSET_LABEL[a.biz_type] || 'קבצים: לוגו, תמונות וחומרים שיווקיים', type: 'files',
        help: 'תמונות, PDF או סרטונים קצרים - עד 25MB לקובץ.' },
      { key: 'assets_link', label: 'או קישור לתיקייה (Google Drive / Dropbox)', type: 'text', placeholder: 'https://...' },
    ],
  },
  {
    key: 'contacts', title: 'אנשי קשר',
    why: 'שנדע למי לפנות בכל נושא - בלי לחפש. ממלאים רק את מי שיש אצלכם.',
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
      { key: 'ga4', label: 'יש לכם Google Analytics (GA4) ו-Tag Manager?', type: 'one', options: ['כן', 'לא', 'לא יודעים'] },
    ],
  },
  {
    // ויטלי, 7.11: "לרכז הכל למקום אחד ולהכין הודעה להעתקה למי שיש בידו את כל הנכסים" - הקמפיינר יודע לעשות את זה מהר
    key: 'access', title: 'גישות ל-VITAS',
    why: 'כל הגישות במקום אחד. אפשר להעתיק את ההודעה ולשלוח אותה כמו שהיא למי שמנהל אצלכם את הקמפיינים והאתר.',
    questions: [
      { key: 'access_owner', label: 'מי מנהל אצלכם את חשבונות הפרסום והאתר? (שם, טלפון או מייל)', type: 'text' },
      { key: 'access_message', label: 'הודעה מוכנה להעתקה', type: 'message' },
      { key: 'google_customer_id', label: 'מספר חשבון גוגל אדס (Customer ID)', type: 'text', when: (a) => has(a, 'channels', 'גוגל'),
        help: 'עשר ספרות, מופיע בפינה העליונה בחשבון גוגל אדס. איתו נשלח בקשת קישור מה-MCC שלנו.', placeholder: '123-456-7890' },
      { key: 'meta_done', label: 'מטא: ניתנה גישת שותף ל-VITAS', type: 'done', when: (a) => has(a, 'channels', 'פייסבוק ואינסטגרם') },
      { key: 'google_done', label: 'גוגל: אושרה בקשת הקישור מה-MCC', type: 'done', when: (a) => has(a, 'channels', 'גוגל') },
      { key: 'other_channels_done', label: 'ערוצים נוספים: ניתנה גישה', type: 'done', when: (a) => ['טיקטוק', 'לינקדאין', 'טאבולה', 'אאוטבריין', 'יוטיוב'].some(c => has(a, 'channels', c)) },
      { key: 'ga4_done', label: 'GA4 ו-Tag Manager: ניתנה הרשאה', type: 'done', when: (a) => a.ga4 === 'כן' },
      { key: 'automation_done', label: 'זאפייר / מייק: הוזמנו כחברים בחשבון', type: 'done', when: (a) => ['זאפייר', 'מייק (Make)'].includes(a.lead_transfer) },
    ],
  },
  {
    key: 'store', title: 'החנות וההזמנות', when: ECOM,
    why: 'ההזמנות בחנות הן מקור האמת: כמה באמת נמכר, בכמה, ומאיזה ערוץ - לא רק מה שהפיקסל מדווח.',
    questions: [
      { key: 'store_platform', label: 'על איזו מערכת החנות?', type: 'one', required: true, options: ['WooCommerce', 'Shopify', 'Wix', 'קונימבו', 'אחר'] },
      { key: 'store_key_done', label: 'ליצור מפתח קריאה בלבד ל-API של החנות', type: 'done',
        help: 'WooCommerce: הגדרות ← מתקדם ← REST API ← הוספת מפתח, הרשאה Read. Shopify: Apps ← Develop apps ← הרשאות read_orders, read_products. לא להדביק את המפתח כאן - נתאם העברה בטוחה.' },
      { key: 'orders_month', label: 'כמה הזמנות בחודש, בערך', type: 'text' },
      { key: 'aov', label: 'סכום הזמנה ממוצע, בערך', type: 'text' },
      { key: 'top_products', label: 'המוצרים / הקטגוריות הכי חשובים לכם', type: 'long' },
      { key: 'pixel_events', label: 'אילו אירועים הפיקסל של מטא מדווח?', type: 'many', options: ['צפייה במוצר', 'הוספה לסל', 'התחלת תשלום', 'רכישה', 'לא יודעים'] },
      { key: 'capi', label: 'מחובר Conversions API (שליחת רכישות לשרת של מטא)?', type: 'one', options: ['כן', 'לא', 'לא יודעים'] },
      { key: 'ga4_ecom', label: 'GA4 מודד רכישות והכנסות (Enhanced Ecommerce)?', type: 'one', options: ['כן', 'לא', 'לא יודעים'] },
      { key: 'email_platform', label: 'מערכת דיוור / אוטומציות', type: 'one', options: ['Klaviyo', 'אקטיב טרייל', 'Mailchimp', 'אחר', 'אין'] },
      { key: 'shipping_returns', label: 'משלוח והחזרות - משהו שחשוב לדעת (משלוח חינם מעל, אחוז החזרות)', type: 'long' },
    ],
  },
  {
    key: 'crm', title: 'מערכת ה-CRM',
    why: 'משם מגיעים הפגישות, ההרשמות והעסקאות - מה שבאמת חשוב בדוח.',
    questions: [
      { key: 'crm', label: 'באיזו מערכת CRM אתם עובדים? (בחנות אונליין - אם יש CRM מעבר לחנות)', type: 'one', required: true, options: ['BMBY', 'פיירברי', 'Zoho', 'Salesforce', 'מנדיי', 'HubSpot', 'אחר', 'אין'] },
      { key: 'crm_other', label: 'איזו מערכת?', type: 'text', when: (a) => a.crm === 'אחר' },
      { key: 'crm_manager', label: 'מי מנהל את המערכת אצלכם?', type: 'text', when: (a) => a.crm && a.crm !== 'אין' },
      { key: 'crm_api', label: 'גישת API כלולה בחבילה שלכם?', type: 'one', options: ['כלולה', 'בתשלום', 'לא יודעים'], when: (a) => a.crm && a.crm !== 'אין' },
      { key: 'crm_fields', label: 'אילו מהשדות האלה כבר קיימים על כל ליד?', type: 'many', when: (a) => a.crm && a.crm !== 'אין',
        help: 'מה שלא קיים - נשלח לכם רשימה מוכנה איך לפתוח אותו במערכת שלכם.',
        options: ['מקור הגעה (רשימה קבועה)', 'utm_source / medium / campaign', 'utm_content / term', 'מזהה מודעה', 'gclid (גוגל)',
          'סטטוס ליד', 'סיבת אי-רלוונטיות / התנגדות', 'איש מכירות אחראי', 'תאריך וסטטוס פגישה', 'הרשמה / חוזה וסכום'] },
      { key: 'crm_key_done', label: 'ליצור מפתח / משתמש API לפי ההוראות למערכת שלכם', type: 'done', when: (a) => a.crm && a.crm !== 'אין',
        help: 'לא להדביק את המפתח כאן - נתאם איתכם העברה בטוחה.' },
    ],
  },
  {
    key: 'process', title: 'איך ליד מגיע ואיך מטפלים בו', titleEcom: 'שירות לקוחות',
    why: 'כדי שהדוח יבדוק את מה שבאמת קורה - וכדי שנוכל להמליץ מה לשפר.',
    questions: [
      { key: 'lead_sources', label: 'כל הדרכים שבהן ליד נכנס', type: 'many', required: true, when: LEADS,
        options: ['טופס לידים בפייסבוק', 'טופס באתר', 'שיחת טלפון', 'וואטסאפ', 'צ\'אט באתר', 'פורטל (יד2 / מדלן)', 'הפניה', 'מגיע למשרד', 'אחר'] },
      { key: 'who_answers', label: 'מי עונה לשיחות?', type: 'one', when: LEADS, options: ['משרד המכירות', 'מוקד חיצוני', 'כל איש מכירות בנייד שלו', 'אחר'] },
      { key: 'call_tracking', label: 'יש מספרי טלפון ייעודיים לכל ערוץ (call tracking)?', type: 'yesno', when: LEADS },
      { key: 'first_call', label: 'תוך כמה זמן מתקשרים לליד חדש, בדרך כלל?', type: 'one', when: LEADS, options: ['עד 5 דקות', 'עד שעה', 'באותו יום', 'למחרת', 'לא קבוע'] },
      { key: 'attempts', label: 'כמה ניסיונות עד שמוותרים?', type: 'text', when: LEADS },
      { key: 'flow', label: 'איך נראה התהליך מליד ועד עסקה? (שיחה, פגישה, הרשמה, חוזה…)', type: 'long', when: LEADS },
      { key: 'reps', label: 'אנשי המכירות', type: 'table', when: LEADS, cols: [{ key: 'name', label: 'שם' }, { key: 'when', label: 'מתי מטפל (בוקר / ערב / סופ"ש)' }] },
      { key: 'service', label: 'שירות לקוחות - איך פונים אליכם?', type: 'many', when: ECOM, options: ['וואטסאפ', 'טלפון', 'צ\'אט באתר', 'מייל', 'אינסטגרם'] },
      { key: 'chat', label: 'יש אצלכם…', type: 'many', options: ['וואטסאפ עסקי', 'בוט', 'צ\'אט באתר', 'אין'] },
    ],
  },
  {
    key: 'more', title: 'ערוצים נוספים',
    why: 'פורטל, דיוור או שלט יכולים להקפיץ לידים בשבוע מסוים - טוב לדעת, כדי לא לייחס את זה בטעות למודעות.',
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
      { key: 'success', label: 'כמה לידים / פגישות / עסקאות בחודש תחשבו הצלחה?', type: 'text', when: LEADS },
      { key: 'target_cost', label: 'עלות לליד או לפגישה שאתם מצפים לה', type: 'text', when: LEADS },
      { key: 'target_roas', label: 'ROAS שתחשבו הצלחה (כמה שקלים מכירות על כל שקל פרסום)', type: 'text', when: ECOM },
      { key: 'target_cpa', label: 'עלות לרכישה מקסימלית שמשתלמת לכם', type: 'text', when: ECOM },
      { key: 'wish', label: 'מה הכי חשוב לכם לראות בדשבורד?', type: 'long' },
    ],
  },
]

// שאלה בחלק מותנה (למשל "החנות" - רק לאיקומרס) יורשת את התנאי של החלק
for (const sec of FORM) if (sec.when) for (const q of sec.questions) { const own = q.when; q.when = own ? (a) => sec.when(a) && own(a) : sec.when }
const ALL_Q = FORM.flatMap(s => s.questions)

/** תווית של שאלה - טקסט קבוע, או פונקציה של התשובות (למשל לפי סוג העסק). */
export const labelOf = (q, a) => (typeof q.label === 'function' ? q.label(a || {}) : q.label)

/**
 * ההודעה להעתקה למי שמנהל את הנכסים (ויטלי, 7.11) - רק מה שרלוונטי לפי התשובות: מטא, גוגל, GA4 ו-Tag Manager,
 * זאפייר / מייק, ערוצים נוספים. בלי סיסמאות: הכל בהזמנה או בשיתוף, כך שהלקוח יכול לבטל בכל רגע.
 */
export function accessMessage(a) {
  a = a || {}
  const ch = Array.isArray(a.channels) ? a.channels : []
  const parts = []
  let n = 0
  const add = (title, lines) => { n++; parts.push(`${n}. ${title}\n${lines.map(l => '   ' + l).join('\n')}`) }
  if (ch.includes('פייסבוק ואינסטגרם') || !ch.length) add('מטא (פייסבוק ואינסטגרם) - גישת שותף', [
    `Business Settings ← Accounts ← Ad accounts ← לבחור את חשבון המודעות ← Assign partners`,
    `מזהה העסק (Business ID) של ${AGENCY.name}: ${AGENCY.metaBusinessId}`,
    'הרשאה: Manage campaigns (או לפחות View performance)',
    'אם אפשר, לשתף באותו אופן גם את הפיקסל (Datasets) ואת עמוד הפייסבוק',
  ])
  if (ch.includes('גוגל') || !ch.length) add('גוגל אדס - קישור ל-MCC', [
    `מספר ה-MCC של ${AGENCY.name}: ${AGENCY.googleMcc}`,
    'נשלח בקשת קישור מה-MCC. לאשר אותה ב: Admin ← Access and security ← Managers',
    'בשביל זה צריך לשלוח לנו את מספר חשבון הגוגל אדס (Customer ID, עשר ספרות)',
  ])
  if (a.ga4 !== 'לא') add('Google Analytics (GA4) ו-Tag Manager', [
    `GA4: Admin ← Property access management ← + ← ${AGENCY.email} ← תפקיד Viewer (או Analyst)`,
    `Tag Manager: Admin ← User Management ← + ← ${AGENCY.email} ← הרשאת Read לחשבון ול-Container`,
  ])
  if (['זאפייר', 'מייק (Make)'].includes(a.lead_transfer)) add(a.lead_transfer === 'זאפייר' ? 'זאפייר' : 'מייק (Make)', [
    a.lead_transfer === 'זאפייר'
      ? `להזמין את ${AGENCY.email} כחבר בחשבון (Settings ← Members ← Invite). אם אין אפשרות, לשתף קישור לכל Zap שמעביר לידים (Share)`
      : `להזמין את ${AGENCY.email} כחבר בארגון / בצוות (Organization ← Members ← Invite)`,
    'בלי לשלוח סיסמה - הזמנה אפשר לבטל בכל רגע',
  ])
  const more = ch.filter(c => ['טיקטוק', 'לינקדאין', 'טאבולה', 'אאוטבריין'].includes(c))
  if (more.length) add('ערוצים נוספים', more.map(c => ({
    'טיקטוק': `TikTok Ads: Business Center ← Members ← להזמין את ${AGENCY.email} (או לשתף את חשבון המודעות כשותף)`,
    'לינקדאין': `LinkedIn Campaign Manager: Account settings ← Manage access ← להוסיף את ${AGENCY.email} כ-Viewer`,
    'טאבולה': `Taboola Ads: Account ← Users ← להזמין את ${AGENCY.email}`,
    'אאוטבריין': `Outbrain Amplify: Settings ← Users ← להזמין את ${AGENCY.email}`,
  })[c]))
  if (a.biz_type === ECOM_TYPE) add('החנות', [
    a.store_platform === 'Shopify'
      ? 'Shopify: Settings ← Apps ← Develop apps ← אפליקציה חדשה עם הרשאות read_orders, read_products'
      : 'WooCommerce: הגדרות ← מתקדם ← REST API ← הוספת מפתח, הרשאה Read',
    'את המפתח לא שולחים במייל או בוואטסאפ - נתאם איתכם העברה בטוחה',
  ])
  const name = a.project_name ? ` (${a.project_name})` : ''
  return [
    `היי, אנחנו מתחילים לעבוד עם ${AGENCY.name}${name} על דשבורד הדוחות.`,
    'צריך לתת להם את הגישות הבאות:',
    '',
    parts.join('\n\n'),
    '',
    `לשאלות: ${AGENCY.email}`,
    'תודה!',
  ].join('\n')
}
const Q_BY_KEY = new Map(ALL_Q.map(q => [q.key, q]))

export const visible = (q, a) => !q.when || !!q.when(a || {})

const filled = (q, v) => {
  if (q.type === 'table') return Array.isArray(v) && v.some(r => r && Object.values(r).some(x => String(x || '').trim()))
  if (q.type === 'many') return Array.isArray(v) && v.length > 0
  if (q.type === 'done') return v === true
  if (q.type === 'files') return Array.isArray(v) && v.length > 0
  return v != null && String(v).trim() !== ''
}
export const isFilled = (q, a) => filled(q, (a || {})[q.key])

/** { done, total } - שאלות שנענו מתוך המוצגות. "בוצע" נספר רק כשסומן. */
export function progress(a) {
  const qs = ALL_Q.filter(q => q.type !== 'message' && visible(q, a))
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
    } else if (q.type === 'files') {
      if (Array.isArray(v)) out[k] = v.slice(0, 30).filter(f => f && typeof f.path === 'string').map(f => ({ name: T(f.name, 200), path: T(f.path, 300), size: Number(f.size) || 0, type: T(f.type, 100) }))
    } else if (q.type === 'message') continue
    else if (q.type === 'done') out[k] = v === true
    else if (q.type === 'one' || q.type === 'yesno') { const opts = q.type === 'yesno' ? ['כן', 'לא'] : q.options; if (opts.includes(v)) out[k] = v; else if (v === '' || v == null) out[k] = '' }
    else out[k] = T(v, q.type === 'long' ? 3000 : 300)
  }
  return out
}

/**
 * אילו שלבים בקליטה לסמן לפי התשובות: { [step]: { status: 'done'|'doing'|'na', note } }.
 * רק מה שאפשר לדעת מהשאלון; שלב שאין עליו מספיק - לא מופיע (ולא נוגעים בו).
 */
export function stepsFromAnswers(a) {
  a = a || {}
  const out = {}
  const set = (step, status, note) => { out[step] = { status, note: note ? ('מהשאלון: ' + note).slice(0, 500) : 'מהשאלון' } }
  const list = (v) => (Array.isArray(v) ? v.join(', ') : '')
  const rows = (v) => (Array.isArray(v) ? v.filter(r => r && Object.values(r).some(x => String(x || '').trim())) : [])
  if (a.biz_type === ECOM_TYPE) {
    for (const k of ['lead_sources', 'sales_flow', 'reps']) set(k, 'na', 'חנות אונליין - אין טיפול בלידים')
    if (a.store_platform) set('crm_which', 'done', 'חנות: ' + a.store_platform + (a.crm && !['אין', ''].includes(a.crm) ? ' · CRM: ' + a.crm : ''))
    if (a.store_key_done) set('crm_key', 'doing', 'הלקוח סימן שיצר מפתח לחנות - לתאם העברה')
    if (Array.isArray(a.pixel_events) && a.pixel_events.length) set('meta_tracking', a.pixel_events.includes('רכישה') ? 'doing' : 'todo', 'אירועי פיקסל: ' + list(a.pixel_events) + (a.capi ? ' · CAPI: ' + a.capi : ''))
    if (a.target_roas || a.target_cpa || a.budget) set('goals', 'done', [a.budget && 'תקציב: ' + a.budget, a.target_roas && 'ROAS: ' + a.target_roas, a.target_cpa && 'עלות לרכישה: ' + a.target_cpa].filter(Boolean).join(' · '))
  }
  if (a.what && a.audience) set('assets', 'done', [a.what, Array.isArray(a.assets_files) && a.assets_files.length && `${a.assets_files.length} קבצים`, a.assets_link].filter(Boolean).join(' · '))
  if (rows(a.contacts).length) set('contacts', 'done', rows(a.contacts).map(r => [r.role, r.name].filter(Boolean).join(': ')).join(' · '))
  if (a.report_weekly || a.report_monthly) set('reports', 'done', [a.report_weekly && 'שבועי: ' + a.report_weekly, a.report_monthly && 'חודשי: ' + a.report_monthly].filter(Boolean).join(' · '))
  const ch = Array.isArray(a.channels) ? a.channels : null
  if (ch) {
    if (!ch.includes('פייסבוק ואינסטגרם')) set('meta_access', 'na', 'לא מפרסמים במטא')
    else if (a.meta_done) set('meta_access', 'doing', 'הלקוח סימן שנתן גישה - לוודא בדשבורד')
    if (!ch.includes('גוגל')) { set('google_access', 'na', 'לא מפרסמים בגוגל'); set('google_tracking', 'na', 'לא מפרסמים בגוגל') }
    else if (a.google_done) set('google_access', 'doing', 'הלקוח סימן שאישר את הקישור - לוודא בדשבורד' + (a.google_customer_id ? ' · Customer ID: ' + a.google_customer_id : ''))
    else if (a.google_customer_id) set('google_access', 'doing', 'Customer ID: ' + a.google_customer_id + ' - לשלוח בקשת קישור מה-MCC')
    const more = ch.filter(c => ['טיקטוק', 'לינקדאין', 'טאבולה', 'אאוטבריין', 'יוטיוב'].includes(c))
    if (!more.length) set('social_more', 'na', 'אין ערוצים נוספים')
    else set('social_more', a.other_channels_done ? 'doing' : 'todo', more.join(', '))
  }
  if (a.other_agencies === 'לא') set('other_agencies', 'na', 'אין סוכנויות נוספות')
  else if (a.other_agencies === 'כן' && rows(a.agencies).length) set('other_agencies', 'done', rows(a.agencies).map(r => [r.company, r.name].filter(Boolean).join(' - ')).join(' · '))
  if (rows(a.pages).length) set('website', 'done', [a.site_platform, ...rows(a.pages).map(r => r.url)].filter(Boolean).join(' · '))
  if (a.lead_transfer === 'חיבור ישיר') set('automation', 'na', 'חיבור ישיר מהאתר ל-CRM')
  else if (['זאפייר', 'מייק (Make)'].includes(a.lead_transfer)) set('automation', a.automation_done ? 'doing' : 'todo', a.lead_transfer)
  if (a.ga4 === 'לא') set('ga4', 'na', 'אין GA4')
  else if (a.ga4 === 'כן' && a.ga4_done) set('ga4', 'doing', 'הלקוח סימן שנתן הרשאה')
  if (a.crm) {
    if (a.crm === 'אין') { for (const s of ['crm_which', 'crm_api', 'crm_fields', 'crm_key', 'crm_statuses', 'crm_objections']) if (!(a.biz_type === ECOM_TYPE && out[s])) set(s, 'na', a.biz_type === ECOM_TYPE ? 'אין CRM מעבר לחנות' : 'אין CRM') }
    else {
      set('crm_which', 'done', [a.crm === 'אחר' ? a.crm_other : a.crm, a.crm_manager && 'מנהל: ' + a.crm_manager].filter(Boolean).join(' · '))
      if (a.crm_api && a.crm_api !== 'לא יודעים') set('crm_api', 'done', a.crm_api)
      if (Array.isArray(a.crm_fields)) {
        const all = Q_BY_KEY.get('crm_fields').options
        const missing = all.filter(f => !a.crm_fields.includes(f))
        set('crm_fields', missing.length ? 'doing' : 'done', missing.length ? 'חסרים: ' + missing.join(', ') : 'כל השדות קיימים')
      }
      if (a.crm_key_done) set('crm_key', 'doing', 'הלקוח סימן שיצר מפתח - לתאם העברה')
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
  if (a.biz_type !== ECOM_TYPE && (a.budget || a.success || a.target_cost)) set('goals', 'done', [a.budget && 'תקציב: ' + a.budget, a.success && 'הצלחה: ' + a.success, a.target_cost && 'יעד עלות: ' + a.target_cost].filter(Boolean).join(' · '))
  return out
}
