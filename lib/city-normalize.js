// City name normalization for BMBY data.
// Handles: English→Hebrew transliterations, common Hebrew typos, HTML entities,
// junk filtering (phones, emails, "Israel"), and abbreviations.
//
// Strategy: explicit map of variant→canonical. We DON'T fuzzy-match unmatched
// inputs (risky for cities), but we do log them so the map can be extended.

// Lower-cased keys → canonical Hebrew city name
const VARIANT_TO_CANONICAL = {
  // ===== מגדל העמק =====
  'migdal ha`emeq': 'מגדל העמק',
  'migdal haemeq': 'מגדל העמק',
  'migdal haemeqck': 'מגדל העמק', // BMBY corruption
  'migdal ha-emeq': 'מגדל העמק',
  'migdal haemek': 'מגדל העמק',
  'migdal': 'מגדל העמק', // ambiguous but most common in this context
  'מגדל (יישוב)': 'מגדל העמק',

  // ===== חיפה =====
  'haifa': 'חיפה',
  'hayfa': 'חיפה',
  'חייפה': 'חיפה',

  // ===== נצרת + נוף הגליל =====
  'nazareth': 'נצרת',
  'nof hagalil': 'נוף הגליל',
  'nazareth illit': 'נוף הגליל',
  'נצרת עילית': 'נוף הגליל',

  // ===== עפולה =====
  '`afula': 'עפולה',
  'afula': 'עפולה',

  // ===== כפר סבא =====
  'kfar saba': 'כפר סבא',
  'kefar saba': 'כפר סבא',
  'kefr saba': 'כפר סבא',
  'kefar sava': 'כפר סבא',
  'k"s': 'כפר סבא',
  'כ"ס': 'כפר סבא',

  // ===== חדרה =====
  'haderah': 'חדרה',
  'hadera': 'חדרה',

  // ===== יקנעם =====
  'yoqn`am': 'יקנעם עילית',
  'yoqnam': 'יקנעם עילית',
  'yoqneam': 'יקנעם עילית',
  'יוקנעם עילית': 'יקנעם עילית',
  'יוקנעם מושבה': 'יקנעם מושבה',
  'יקנעם': 'יקנעם עילית',

  // ===== עכו =====
  'acre': 'עכו',
  'akko': 'עכו',
  '`akko': 'עכו',

  // ===== טבריה =====
  'tiberias': 'טבריה',
  'tveriya': 'טבריה',

  // ===== באר שבע =====
  'beersheba': 'באר שבע',
  'beer sheva': 'באר שבע',
  'be"sh': 'באר שבע',
  'ב"ש': 'באר שבע',

  // ===== ירושלים =====
  'jerusalem': 'ירושלים',
  'yerushalayim': 'ירושלים',
  'י-ם': 'ירושלים',
  'י"ם': 'ירושלים',

  // ===== תל אביב =====
  'tel aviv': 'תל אביב יפו',
  'tel aviv-yafo': 'תל אביב יפו',
  'tel aviv yafo': 'תל אביב יפו',
  'ת"א': 'תל אביב יפו',
  'תל אביב': 'תל אביב יפו',

  // ===== רמת גן =====
  'ramat gan': 'רמת גן',
  'ramat-gan': 'רמת גן',
  'ר"ג': 'רמת גן',

  // ===== פתח תקווה =====
  'petach tikva': 'פתח תקווה',
  'petah tikva': 'פתח תקווה',
  'פ"ת': 'פתח תקווה',

  // ===== ראשון לציון =====
  'rishon lezion': 'ראשון לציון',
  'rishon le-zion': 'ראשון לציון',
  'ראשל"צ': 'ראשון לציון',

  // ===== רעננה =====
  'ra`anana': 'רעננה',
  "ra'anana": 'רעננה',
  'raanana': 'רעננה',

  // ===== הרצליה =====
  'herzliya': 'הרצליה',
  'herzeliya': 'הרצליה',

  // ===== כפר יונה =====
  'kefar yona': 'כפר יונה',
  'kfar yona': 'כפר יונה',

  // ===== כרמיאל =====
  "karmi'el": 'כרמיאל',
  'karmiel': 'כרמיאל',

  // ===== עתלית =====
  'atlit': 'עתלית',
  '`atlit': 'עתלית',

  // ===== מודיעין =====
  'modi`in': 'מודיעין',
  "modi'in": 'מודיעין',
  'modiin': 'מודיעין',

  // ===== זכרון יעקב =====
  'zicron yaakov': 'זכרון יעקב',
  'zichron ya`akov': 'זכרון יעקב',
  "zikhron ya'aqov": 'זכרון יעקב',

  // ===== קריות =====
  'qiryat atta': 'קרית אתא',
  'qiryat ata': 'קרית אתא',
  'qiryat yam': 'קרית ים',
  'kiryat hayim': 'קרית חיים',
  'qiryat haim': 'קרית חיים',
  'qiryat bialik': 'קרית ביאליק',
  'qiryat motzkin': 'קרית מוצקין',

  // ===== ערים נוספות (תעתיקים) =====
  'rahat': 'רהט',
  'bi`ina': 'בענה',
  "bi'ina": 'בענה',
  'iksal': 'אכסאל',
  'איכסאל': 'אכסאל',
  'mash had': 'משהד',
  'mash-had': 'משהד',
  'qalansuwa': 'קלנסואה',
  'qalansuwah': 'קלנסואה',
  'metulla': 'מטולה',
  'kefar weradim': 'כפר ורדים',
  'kefar `azza': 'כפר עזה',
  'or yehuda': 'אור יהודה',
  'yehud': 'יהוד',
  'even yehuda': 'אבן יהודה',
  'kadima-zoran': 'קדימה צורן',
  'pardes hanah': 'פרדס חנה',
  'pardes hanna': 'פרדס חנה',
  'pardesiya': 'פרדסיה',
  'harish': 'חריש',
  'tzur yitzhak': 'צור יצחק',
  'timrat': 'תמרת',
  'hosha`ya': 'הושעיה',
  "be'er ya'akov": 'באר יעקב',
  "giv'at shmuel": 'גבעת שמואל',
  'bat hefer': 'בת חפר',
  'harutzim': 'חרוצים',
  'nizzane `oz': 'ניצני עוז',
  'tel `adashim': 'תל עדשים',
  "shfar'am": 'שפרעם',
  'julis': 'ג\'וליס',
  'abu sinan': 'אבו סנאן',
  'baka': 'באקה אל-גרביה',

  // ===== טייפוסים בעברית =====
  'מגבעתיים': 'גבעתיים',
  'נס צוונה': 'נס ציונה',
  'דימונננה': 'דימונה',
  'דימונה': 'דימונה',

  // ===== HTML-entity Arabic decoded → Hebrew =====
  // (these will be decoded first, then matched)
  'الناصره': 'נצרת',
  'الناصرة': 'נצרת',
  'باقة الغربية': 'באקה אל-גרביה',
  'باقه الغربه': 'באקה אל-גרביה',
  'אלנאצרה': 'נצרת',
  'באקה אלגרבה': 'באקה אל-גרביה',
}

// Junk patterns — return '' (no city)
const JUNK_PATTERNS = [
  /^\d+$/,                  // pure digits ("58")
  /^[\d\s\-+()]+$/,         // phone-like
  /@/,                       // email
  /^israel$/i,              // generic "Israel"
  /^\s*$/,                   // empty/whitespace
]

// Decode HTML numeric entities (&#1575; etc.) — those exist in BMBY for Arabic
function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
}

// Strip leading/trailing punctuation, normalize whitespace, lowercase for matching
function basicClean(s) {
  return s
    .replace(/^[,;:'"\s]+|[,;:'"\s]+$/g, '') // leading/trailing junk
    .replace(/\s+/g, ' ')                     // collapse whitespace
    .trim()
}

/**
 * Normalize a city name.
 * Returns canonical Hebrew name, or '' if junk, or the cleaned input if no match.
 */
export function normalizeCity(input) {
  if (!input) return ''
  let s = String(input)

  // Decode HTML entities first
  s = decodeEntities(s)
  s = basicClean(s)
  if (!s) return ''

  // Junk filter
  for (const p of JUNK_PATTERNS) {
    if (p.test(s)) return ''
  }

  // Exact match (case-sensitive Hebrew)
  if (VARIANT_TO_CANONICAL[s]) return VARIANT_TO_CANONICAL[s]

  // Case-insensitive lookup
  const lower = s.toLowerCase()
  if (VARIANT_TO_CANONICAL[lower]) return VARIANT_TO_CANONICAL[lower]

  // No mapping — return cleaned input as-is
  return s
}

// Export the map for tests/admin to show unmapped values
export const _VARIANT_MAP = VARIANT_TO_CANONICAL
