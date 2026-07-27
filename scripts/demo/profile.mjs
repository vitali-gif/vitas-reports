/**
 * scripts/demo/profile.js
 * ─────────────────────────────────────────────────────────────────────────────
 * הפרופיל המספרי הקפוא של פרויקט הדמו.
 *
 * זהו **המקור היחיד** לכל מספר שמופיע בדמו. אין כאן שום מחרוזת שמקורה
 * בנתון אמיתי — רק היקפים, יחסים והתפלגויות.
 *
 * ⚠️  _source: 'PLACEHOLDER'
 *     הערכים הנוכחיים הם אומדן מקצועי לפרויקט נדל״ן בודד. לפני עלייה לאוויר
 *     יש להריץ `node scripts/demo/extract-profile.js` מול ONCE האמיתי, שיחליף
 *     את הקובץ הזה בפרופיל אמיתי (מספרים בלבד) ויסמן _source: 'ONCE'.
 *     ראה §9 שלב 1 במסמך האפיון.
 *
 * שינוי כל מספר כאן משנה את הדמו — וזה המקום היחיד שצריך לגעת בו כדי לכוונן
 * את הנרטיב המכירתי.
 */

export const PROFILE = {
  _source: 'PLACEHOLDER',
  _generatedFor: 'אופק ים / נוף אדמה בע״מ',

  /** חודש הבסיס של הדאטהסט. ה-seeder מזיז ממנו תאריכים קדימה. */
  baseMonth: '2026-07',

  /** seed קבוע ל-PRNG — מבטיח שהפלט זהה בכל הרצה, לנצח. */
  seed: 20260726,

  periods: {
    // ── חודש נוכחי (חלקי — עד אמצע החודש, כמו במציאות) ──────────────────
    current: {
      key: 'currentMonth',
      spanDays: 26,
      crm: {
        totalLeads: 143,
        relevantShare: 0.72,
        meetingScheduledRate: 0.24,   // מתוך לידים
        meetingCompletedRate: 0.71,   // מתוך פגישות שתואמו
        meetingCancelledRate: 0.13,   // מתוך פגישות שתואמו
        registrationRate: 0.061,      // מתוך לידים
        avgRegistrationValue: 2_180_000,
        contractRate: 0.55,           // מתוך הרשמות
        avgContractValue: 2_240_000,
        noResponseRate: 0.11,
        respondedShare: 0.89,
        // ⚠️ שני אלה משמשים כ**יחס** בלבד (שעות עסקים ÷ זמן רציף = 0.65),
        //    ולא כיעד לממוצע. הממוצע בפועל נגזר מ-responseBucketWeights
        //    ומ-BUCKET_RANGES. את הערך שהתקבל אפשר לראות בפלט של
        //    verify-dataset.mjs — כוונן שם דרך משקלי הדליים.
        avgResponseMinutes: 94,
        avgBusinessMinutes: 61,
      },
      facebook: { spend: 18_400, impressions: 612_000, reach: 191_000, clicks: 9_150, leads: 61 },
      google:   { spend: 12_900, impressions: 214_000, reach: 0,       clicks: 5_320, leads: 39 },
    },

    // ── חודש קודם (מלא) ─────────────────────────────────────────────────
    previous: {
      key: 'lastMonth',
      spanDays: 30,
      crm: {
        totalLeads: 168,
        relevantShare: 0.69,
        meetingScheduledRate: 0.21,
        meetingCompletedRate: 0.66,
        meetingCancelledRate: 0.16,
        registrationRate: 0.054,
        avgRegistrationValue: 2_120_000,
        contractRate: 0.50,
        avgContractValue: 2_195_000,
        noResponseRate: 0.15,
        respondedShare: 0.85,
        avgResponseMinutes: 128,
        avgBusinessMinutes: 83,
      },
      facebook: { spend: 21_300, impressions: 704_000, reach: 223_000, clicks: 10_180, leads: 68 },
      google:   { spend: 14_600, impressions: 248_000, reach: 0,       clicks: 5_940,  leads: 44 },
    },

    // ── Q2 (אפריל–יוני, מצטבר) ──────────────────────────────────────────
    q2: {
      key: 'q2',
      spanDays: 91,
      crm: {
        totalLeads: 489,
        relevantShare: 0.70,
        meetingScheduledRate: 0.22,
        meetingCompletedRate: 0.68,
        meetingCancelledRate: 0.15,
        registrationRate: 0.057,
        avgRegistrationValue: 2_140_000,
        contractRate: 0.52,
        avgContractValue: 2_210_000,
        noResponseRate: 0.14,
        respondedShare: 0.86,
        avgResponseMinutes: 116,
        avgBusinessMinutes: 75,
      },
      facebook: { spend: 61_800, impressions: 2_034_000, reach: 588_000, clicks: 29_400, leads: 197 },
      google:   { spend: 42_100, impressions: 719_000,   reach: 0,       clicks: 17_260, leads: 126 },
    },
  },

  /** משקלי מקורות הגעה ב-CRM (מנורמלים אוטומטית ל-1). */
  sourceMix: {
    'פייסבוק':        42,
    'גוגל':           27,
    'פורטל נדל״ן א׳': 13,
    'אתר הפרויקט':     8,
    'המלצה מלקוח':     5,
    'פורטל נדל״ן ב׳':  3,
    'מוקד טלפוני':     2,
  },

  /**
   * איכות יחסית של כל מקור (מכפיל של relevantShare).
   * זה מה שמפעיל את המלצת "מקור ששורף תקציב": buildIrrelevantSourceRec דורש
   * שמקור אחד יהיה גרוע פי 1.5 מהממוצע ובפער של 10 נק׳ אחוז לפחות.
   */
  sourceRelevanceFactor: {
    'פייסבוק':        1.06,
    'גוגל':           1.22,
    'פורטל נדל״ן א׳': 0.42,
    'אתר הפרויקט':    1.15,
    'המלצה מלקוח':    1.30,
    'פורטל נדל״ן ב׳': 0.70,
    'מוקד טלפוני':    0.85,
  },

  /** חלוקת לידים בין אנשי המכירות (לפי הסדר ב-SALESPEOPLE). */
  salespeopleShare: [0.28, 0.24, 0.20, 0.16, 0.12],

  /** זמן תגובה ממוצע יחסי לכל איש מכירות (מכפיל של avgResponseMinutes). */
  salespeopleSpeedFactor: [0.62, 0.85, 1.05, 1.28, 1.74],

  /** התפלגות לידים לפי יום בשבוע: ראשון…שבת. */
  dayOfWeekWeights: [19, 21, 20, 18, 13, 4, 5],

  /** יחס תיאום פגישה יחסי לכל יום (מכפיל של meetingScheduledRate). */
  dayOfWeekConvFactor: [1.05, 1.12, 1.00, 0.96, 0.88, 0.62, 0.71],

  /** התפלגות לידים לפי שעה ביום (0-23). */
  // "שעות שקטות" (13, 21, 22) מפעילות את המלצת תזמון התקציב —
  // buildHourOfDayRec דורש ≥2 שעות בחלון 08:00-22:00 עם <40% מהממוצע.
  hourlyLeadWeights: [
    2, 1, 1, 1, 1, 2, 5, 12, 22, 40, 52, 56,
    30, 14, 44, 55, 60, 62, 50, 38, 26, 9, 6, 4,
  ],

  /** התפלגות תיאום פגישות לפי שעה ביום (0-23). */
  hourlyApptWeights: [
    0, 0, 0, 0, 0, 0, 1, 4, 18, 34, 41, 38,
    26, 19, 31, 39, 44, 40, 28, 15, 7, 3, 1, 0,
  ],

  /**
   * התפלגות דלי זמן תגובה — 7 דליים, בדיוק כמו ב-app/api/bmby/fetch:
   * 0-15m / 15m-1h / 1h-4h / 4h-8h / 8h-1d / 1d-3d / 3d+
   */
  responseBucketWeights: [14, 28, 34, 12, 7, 3, 2],
  // הערה: ההמלצה מחושבת על **שעות עסקים** (business.buckets), שהן קצרות
  // יותר מהזמן הרציף — ולכן ההתפלגות "נדחפת" לדליים המהירים. הדלי הגדול
  // ביותר בסקאלה העסקית חייב לא להיות המהיר ביותר, אחרת
  // buildResponseTimeRec לא מוצא דלי מהיר יותר להשוות אליו ומחזיר null.

  /**
   * יחס תיאום פגישות יחסי לכל דלי זמן תגובה. זה הסיפור המרכזי של הדשבורד:
   * מענה מהיר → יותר פגישות. ערכים תלולים מספיק כדי שההמלצה תזהה את הפער.
   */
  speedConvFactor: [1.00, 0.58, 0.27, 0.15, 0.09, 0.05, 0.03],

  /** משקלי ערים (לפי הסדר ב-CITIES; ערך 0 = לא מופיעה). */
  // ריכוז גבוה בעיר המובילה (~30%) מפעיל את "עיר הזהב";
  // buildCityRec דורש נתח ≥20% ולפחות 8 לידים.
  cityWeights: [
    210, 84, 70, 62, 55, 44,
    32, 28, 24, 21, 18, 26,
    15, 11, 13, 9, 7, 8,
  ],

  /**
   * יחס תיאום פגישות יחסי לכל עיר (מכפיל של meetingScheduledRate).
   * העיר באינדקס 3 (הרצליה) מכוונת להיות "שורפת תקציב" —
   * buildGeoWasteRec דורש המרה מתחת ל-70% מהממוצע ובפער ≥8 נק׳ אחוז.
   */
  cityConvFactor: [
    1.15, 1.05, 0.95, 0.34, 1.20, 0.90,
    1.00, 0.85, 1.10, 0.95, 1.05, 0.80,
    1.00, 1.00, 1.00, 1.00, 1.00, 1.00,
  ],

  /** משקלי התנגדויות (לפי הסדר ב-OBJECTIONS). */
  // ההתנגדות המובילה חייבת להיות ≥25% מכלל ההתנגדויות (buildObjectionRec).
  objectionWeights: [42, 18, 14, 12, 10, 8, 7, 5, 4, 9],

  /** חלוקת תקציב בין קמפייני Facebook (מנורמל). */
  fbCampaignWeights: [38, 27, 21, 14],

  /** חלוקת תקציב בין קמפייני Google (מנורמל). */
  googleCampaignWeights: [22, 31, 33, 14],

  /** breakdown גיל×מגדר ב-Meta. */
  ageBuckets:    ['25-34', '35-44', '45-54', '55-64', '65+'],
  ageWeights:    [18, 31, 26, 17, 8],
  genderBuckets: ['male', 'female'],
  genderWeights: [54, 46],

  /**
   * יעילות יחסית של כל יחידת מודעה (מכפיל על הקצאת הלידים, בלי לגעת בהוצאה).
   * זה מה שיוצר פיזור CPL אמיתי בין מודעות — בלעדיו כל המודעות מקבלות
   * בדיוק אותו CPL ו-buildCreativeRec לא מוצא "מודעה מנצחת/מפסידה".
   * הערך 0 = מודעה שבזבזה תקציב ללא לידים (מועמדת מיידית להפסקה).
   */
  adEfficiency: [
    2.05, 1.55, 1.30, 1.12, 1.00, 0.94, 0.86, 0.78,
    0.72, 0.64, 0.58, 0.52, 0.46, 0.38, 0.28, 0.00,
  ],

  /** תקציב חודשי מוצהר (פס התקציב בדשבורד). */
  monthlyBudget: 36_000,
}

export default PROFILE
