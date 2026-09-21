// ===== SHARED HELPERS =====
export function num(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

export function formatCurrency(n) {
  return '\u20aa' + Number(n).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function formatCurrencyCompact(n) {
  const num = Number(n);
  if (num >= 1000000) return '\u20aa' + (num / 1000000).toLocaleString('he-IL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'מ\u2019';
  if (num >= 1000) return '\u20aa' + (num / 1000).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + 'א\u2019';
  return '\u20aa' + num.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function formatNum(n) {
  return Number(n).toLocaleString('he-IL');
}

export function formatMonth(monthStr) {
  if (!monthStr) return '';
  // Custom date range: "YYYY-MM-DD_YYYY-MM-DD"
  if (monthStr.includes('_')) {
    const [a, b] = monthStr.split('_');
    const fmt = d => {
      const parts = d.split('-');
      if (parts.length !== 3) return d;
      return parts[2] + '.' + parts[1] + '.' + parts[0].slice(2);
    };
    return fmt(a) + ' – ' + fmt(b);
  }
  const [y, m] = monthStr.split('-');
  const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  return months[parseInt(m) - 1] + ' ' + y;
}

// Shift one calendar month back. Works for both "YYYY-MM" and "YYYY-MM-DD_YYYY-MM-DD".
function shiftOneMonthBack(dateStr) {
  // Expects "YYYY-MM-DD" or "YYYY-MM"
  const parts = dateStr.split('-').map(Number);
  const [y, m, d] = parts;
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  if (d === undefined) return prevY + '-' + String(prevM).padStart(2, '0');
  // Clamp day to the last day of the previous month
  const lastDay = new Date(prevY, prevM, 0).getDate();
  const clampedDay = Math.min(d, lastDay);
  return prevY + '-' + String(prevM).padStart(2, '0') + '-' + String(clampedDay).padStart(2, '0');
}

export function getPrevMonth(monthStr) {
  if (!monthStr) return '';
  // Custom date range: "YYYY-MM-DD_YYYY-MM-DD"
  if (monthStr.includes('_')) {
    const [a, b] = monthStr.split('_');
    return shiftOneMonthBack(a) + '_' + shiftOneMonthBack(b);
  }
  return shiftOneMonthBack(monthStr);
}

/**
 * התקופה שמולה משווים כש"השוואה לאותה תקופה" דלוק.
 *
 * ההחלטה של ויטלי (21.9): **אותה התקופה בחודש שעבר.**
 *
 * הפער שזה סוגר: בחודש שרץ, getPrevMonth('2026-09') החזיר '2026-08' —
 * 21 יום של ספטמבר מול 31 יום של אוגוסט. כל מדד מצטבר (תקציב, לידים,
 * פגישות) הראה "ירידה" שלא קרתה. עכשיו החודש שרץ משווה מול 1–21 באוגוסט.
 *
 * שלושת המקרים:
 *   '2026-08-05_2026-09-04'  →  '2026-07-05_2026-08-04'   (טווח מותאם)
 *   '2026-08'  (חודש שהסתיים) →  '2026-07'                 (חודש מלא מול מלא)
 *   '2026-09'  (החודש שרץ)    →  '2026-08-01_2026-08-21'   (אותם ימים בדיוק)
 *
 * today מוזרק כדי שאפשר יהיה לבדוק; בייצור זה פשוט היום.
 */
export function comparisonPeriodKey(monthStr, today = new Date()) {
  if (!monthStr) return '';
  if (monthStr.includes('_')) return getPrevMonth(monthStr);

  const [y, m] = monthStr.split('-').map(Number);
  if (!y || !m) return getPrevMonth(monthStr);

  const isRunningMonth = y === today.getFullYear() && m === today.getMonth() + 1;
  if (!isRunningMonth) return shiftOneMonthBack(monthStr);

  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  const lastDay = new Date(prevY, prevM, 0).getDate();
  const day = Math.min(today.getDate(), lastDay);   // 31 בחודש מול פברואר
  const mm = String(prevM).padStart(2, '0');
  return `${prevY}-${mm}-01_${prevY}-${mm}-${String(day).padStart(2, '0')}`;
}

/** תיאור קריא של תקופת ההשוואה, להצגה ליד האחוז. */
export function comparisonPeriodLabel(monthStr, today = new Date()) {
  const key = comparisonPeriodKey(monthStr, today);
  if (!key) return '';
  if (!key.includes('_')) return formatMonth(key);
  const [a, b] = key.split('_');
  const d = s => s.split('-').reverse().slice(0, 2).join('.');   // YYYY-MM-DD → DD.MM
  return `${d(a)}–${d(b)}`;
}

export function changePercent(current, previous, isCost) {
  if (!previous || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const isGood = isCost ? pct <= 0 : pct >= 0;
  return { pct, isGood };
}

export function findCol(row, possibleNames) {
  const clean = s => s.replace(/[\u200e\u200f\u200b\u200c\u200d\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').toLowerCase().trim();
  for (const key of Object.keys(row)) {
    const lk = clean(key);
    for (const name of possibleNames) {
      if (lk === clean(name)) return row[key];
    }
  }
  return '';
}

export function mapFacebookRows(jsonRows) {
  return jsonRows.map(row => ({
    campaign: findCol(row, ['campaign name', 'campaign', '\u05e9\u05dd \u05d4\u05e7\u05de\u05e4\u05d9\u05d9\u05df', '\u05e9\u05dd \u05e7\u05de\u05e4\u05d9\u05d9\u05df', 'Campaign name']),
    adSet: findCol(row, ['ad set name', 'ad set', '\u05e9\u05dd \u05e1\u05d3\u05e8\u05ea \u05d4\u05de\u05d5\u05d3\u05e2\u05d5\u05ea', '\u05e9\u05dd \u05e7\u05d1\u05d5\u05e6\u05ea \u05de\u05d5\u05d3\u05e2\u05d5\u05ea', 'Ad set name', 'Ad Set Name']),
    adName: findCol(row, ['ad name', 'ad', '\u05e9\u05dd \u05d4\u05de\u05d5\u05d3\u05e2\u05d4', '\u05e9\u05dd \u05de\u05d5\u05d3\u05e2\u05d4', 'Ad name', 'Ad Name']),
    adText: findCol(row, ['body', 'ad body', '\u05d8\u05e7\u05e1\u05d8', 'body (dynamic creative)', 'Body', 'Body (Dynamic Creative)', 'Link message']),
    gender: findCol(row, ['gender', '\u05de\u05d2\u05d3\u05e8', 'Gender']),
    age: findCol(row, ['age', '\u05d2\u05d9\u05dc', 'Age']),
    spend: findCol(row, ['amount spent (ils)', 'amount spent', 'spend', 'cost', '\u05d4\u05e1\u05db\u05d5\u05dd \u05e9\u05e9\u05d5\u05dc\u05dd (ILS)', '\u05d4\u05e1\u05db\u05d5\u05dd \u05e9\u05e9\u05d5\u05dc\u05dd', 'Amount spent (ILS)', 'Amount Spent (ILS)', 'Amount spent']),
    impressions: findCol(row, ['impressions', '\u05d7\u05e9\u05d9\u05e4\u05d5\u05ea', 'Impressions']),
    reach: findCol(row, ['reach', '\u05ea\u05e4\u05d5\u05e6\u05d4', '\u05d7\u05e9\u05d9\u05e4\u05d4 \u05d9\u05d9\u05d7\u05d5\u05d3\u05d9\u05ea', 'Reach']),
    clicks: findCol(row, ['link clicks', 'clicks (all)', 'clicks', '\u05e7\u05dc\u05d9\u05e7\u05d9\u05dd \u05e2\u05dc \u05e7\u05d9\u05e9\u05d5\u05e8', 'Link clicks', 'Clicks (all)', 'Link Clicks']),
    leads: findCol(row, ['leads', 'results', '\u05ea\u05d5\u05e6\u05d0\u05d5\u05ea', '\u05dc\u05d9\u05d3\u05d9\u05dd', 'Leads', 'Results', 'on-facebook leads', 'On-Facebook Leads', 'On-facebook leads']),
  })).filter(r => r.campaign || r.adSet || r.adName);
}

export function mapGoogleRows(jsonRows) {
  return jsonRows.map(row => ({
    campaign: findCol(row, ['campaign', 'Campaign', '\u05e7\u05de\u05e4\u05d9\u05d9\u05df', '\u05e9\u05dd \u05d4\u05e7\u05de\u05e4\u05d9\u05d9\u05df', '\u05e7\u05de\u05e4\u05d9\u05d9\u05e0\u05d9\u05dd']),
    adSet: findCol(row, ['ad group', 'Ad group', 'Ad Group', '\u05e7\u05d1\u05d5\u05e6\u05ea \u05de\u05d5\u05d3\u05e2\u05d5\u05ea', '\u05e7\u05d1\u05d5\u05e6\u05d4 \u05e9\u05dc \u05e0\u05db\u05e1\u05d9\u05dd \u05d3\u05d9\u05d2\u05d9\u05d8\u05dc\u05d9\u05d9\u05dd', '\u05e9\u05dd \u05e1\u05d3\u05e8\u05ea \u05d4\u05de\u05d5\u05d3\u05e2\u05d5\u05ea']),
    adName: findCol(row, ['ad', 'Ad', '\u05de\u05d5\u05d3\u05e2\u05d4', 'Headline 1', '\u05db\u05d5\u05ea\u05e8\u05d5\u05ea', '\u05db\u05d5\u05ea\u05e8\u05d5\u05ea \u05d0\u05e8\u05d5\u05db\u05d5\u05ea']),
    adText: findCol(row, ['description', 'Description', 'Description 1', '\u05ea\u05d9\u05d0\u05d5\u05e8\u05d9\u05dd']),
    gender: findCol(row, ['gender', 'Gender']),
    age: findCol(row, ['age', 'Age', 'Age range']),
    spend: findCol(row, ['cost', 'Cost', '\u05e2\u05dc\u05d5\u05ea', '\u05de\u05d7\u05d9\u05e8', '\u05d4\u05e1\u05db\u05d5\u05dd \u05e9\u05e9\u05d5\u05dc\u05dd']),
    impressions: findCol(row, ['impressions', 'Impressions', 'Impr.', '\u05d7\u05e9\u05d9\u05e4\u05d5\u05ea']),
    reach: findCol(row, ['reach', 'Reach']),
    clicks: findCol(row, ['clicks', 'Clicks', '\u05e7\u05dc\u05d9\u05e7\u05d9\u05dd']),
    leads: findCol(row, ['conversions', 'Conversions', '\u05d4\u05de\u05e8\u05d5\u05ea', 'leads', 'Leads', '\u05ea\u05d5\u05e6\u05d0\u05d5\u05ea']),
  })).filter(r => r.campaign || r.adSet || r.adName);
}

export function mapCrmRows(jsonRows) {
  return jsonRows.map(row => ({
    source: findCol(row, ['\u05e1\u05d5\u05d2 \u05de\u05d3\u05d9\u05d4', '\u05de\u05d3\u05d9\u05d4', '\u05e1\u05d5\u05d2 \u05de\u05d3\u05d9\u05d4/\u05de\u05d3\u05d9\u05d4', '\u05de\u05e7\u05d5\u05e8', 'source', 'media', 'media type']),
    totalLeads: findCol(row, ['\u05e1\u05d4"\u05db \u05dc\u05d9\u05d3\u05d9\u05dd', '\u05e1\u05d4\u05db \u05dc\u05d9\u05d3\u05d9\u05dd', '\u05e1\u05d4\u05f4\u05db \u05dc\u05d9\u05d3\u05d9\u05dd', 'total leads']),
    relevantLeads: findCol(row, ['\u05dc\u05d9\u05d3\u05d9\u05dd \u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d9\u05dd', '\u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d9\u05dd', '\u05dc\u05d9\u05d3\u05d9\u05dd \u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05dd', 'relevant leads']),
    irrelevantLeads: findCol(row, ['\u05dc\u05d0 \u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d9\u05dd', '\u05dc\u05d0 \u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05dd', 'irrelevant leads']),
    meetingsScheduled: findCol(row, ['\u05e4\u05d2\u05d9\u05e9\u05d5\u05ea \u05ea\u05d5\u05d0\u05de\u05d5', '\u05ea\u05d5\u05d0\u05de\u05d5', 'meetings scheduled']),
    meetingsScheduledRate: findCol(row, ['\u05dc\u05d9\u05d3\u05d9\u05dd/\u05ea\u05d5\u05d0\u05de\u05d5', 'leads/scheduled']),
    meetingsCompleted: findCol(row, ['\u05d1\u05d5\u05e6\u05e2\u05d5', 'meetings completed', 'completed']),
    meetingsCompletedRate: findCol(row, ['\u05dc\u05d9\u05d3\u05d9\u05dd/\u05d1\u05d5\u05e6\u05e2\u05d5', 'leads/completed']),
    meetingsCancelled: findCol(row, ['\u05d1\u05d5\u05d8\u05dc\u05d5', 'cancelled', 'canceled']),
    registrations: findCol(row, ['\u05d4\u05d6\u05d3\u05de\u05e0\u05d5\u05d9\u05d5\u05ea \u05de\u05db\u05d9\u05e8\u05d4', '\u05d4\u05e8\u05e9\u05de\u05d5\u05ea', '\u05d4\u05e8\u05e9\u05de\u05d4', 'הזדמנות מכירה', 'opportunities', 'registrations']),
    registrationValue: findCol(row, ['\u05e1\u05db\u05d5\u05dd \u05d4\u05d6\u05d3\u05de\u05e0\u05d5\u05d9\u05d5\u05ea \u05de\u05db\u05d9\u05e8\u05d4', '\u05e1\u05db\u05d5\u05dd \u05d4\u05d6\u05d3\u05de\u05e0\u05d5\u05d9\u05d5\u05ea', '\u05e9\u05d5\u05d5\u05d9 \u05d4\u05e8\u05e9\u05de\u05d5\u05ea', 'opportunity value']),
    contracts: findCol(row, ['\u05de\u05db\u05d9\u05e8\u05d5\u05ea \u05e2\u05e1\u05e7\u05d0\u05d5\u05ea', '\u05e2\u05e1\u05e7\u05d0\u05d5\u05ea', '\u05d7\u05d5\u05d6\u05d9\u05dd', 'deals', 'contracts']),
    contractValue: findCol(row, ['\u05e1\u05db\u05d5\u05dd \u05d4\u05e2\u05e1\u05e7\u05d0\u05d5\u05ea', '\u05e1\u05db\u05d5\u05dd \u05e2\u05e1\u05e7\u05d0\u05d5\u05ea', '\u05e9\u05d5\u05d5\u05d9 \u05e2\u05e1\u05e7\u05d0\u05d5\u05ea', '\u05e9\u05d5\u05d5\u05d9 \u05d7\u05d5\u05d6\u05d9\u05dd', 'deal value']),
  })).filter(r => { const s = (r.source || '').toLowerCase(); return s && !s.includes('סך הכל'); });
}

export function aggregateCrmRows(rows) {
  const totals = { totalLeads: 0, relevantLeads: 0, irrelevantLeads: 0, meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0, registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0 };
  const sources = {};

  rows.forEach(row => {
    const vals = {
      totalLeads: num(row.totalLeads),
      relevantLeads: num(row.relevantLeads),
      irrelevantLeads: num(row.irrelevantLeads),
      meetingsScheduled: num(row.meetingsScheduled),
      meetingsCompleted: num(row.meetingsCompleted),
      meetingsCancelled: num(row.meetingsCancelled),
      registrations: num(row.registrations),
      registrationValue: num(row.registrationValue),
      contracts: num(row.contracts),
      contractValue: num(row.contractValue),
    };

    Object.keys(totals).forEach(k => { totals[k] += vals[k]; });

    const src = row.source || '\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2';
    if (!sources[src]) sources[src] = { totalLeads: 0, relevantLeads: 0, irrelevantLeads: 0, meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0, registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0, leads: [] };
    Object.keys(vals).forEach(k => { sources[src][k] += vals[k]; });
    if (Array.isArray(row.leads) && row.leads.length) sources[src].leads = (sources[src].leads || []).concat(row.leads);
  });

  totals.scheduledRate = totals.totalLeads > 0 ? (totals.meetingsScheduled / totals.totalLeads * 100) : 0;
  totals.completedRate = totals.totalLeads > 0 ? (totals.meetingsCompleted / totals.totalLeads * 100) : 0;
  totals.relevantRate = totals.totalLeads > 0 ? (totals.relevantLeads / totals.totalLeads * 100) : 0;
  totals.contractRate = totals.totalLeads > 0 ? (totals.contracts / totals.totalLeads * 100) : 0;

  return { totals, sources };
}

export function aggregateRows(rows) {
  const totals = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 };
  const campaigns = {};
  const adSets = {};
  const ads = {};
  const genders = {};
  const ages = {};

  rows.forEach(row => {
    const spend = num(row.spend);
    const impr = num(row.impressions);
    const reach = num(row.reach);
    const clicks = num(row.clicks);
    const leads = num(row.leads);
    totals.spend += spend;
    totals.impressions += impr;
    totals.reach += reach;
    totals.clicks += clicks;
    totals.leads += leads;

    const add = (map, key) => {
      if (!key) key = '\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2';
      if (!map[key]) map[key] = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 };
      map[key].spend += spend;
      map[key].impressions += impr;
      map[key].reach += reach;
      map[key].clicks += clicks;
      map[key].leads += leads;
    };

    add(campaigns, row.campaign);
    add(adSets, row.adSet);

    const adKey = row.adName || '\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2';
    if (!ads[adKey]) ads[adKey] = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, text: '' };
    ads[adKey].spend += spend;
    ads[adKey].impressions += impr;
    ads[adKey].reach += reach;
    ads[adKey].clicks += clicks;
    ads[adKey].leads += leads;
    if (row.adText) ads[adKey].text = row.adText;

    add(genders, row.gender);
    add(ages, row.age);
  });

  totals.cpl = totals.leads > 0 ? totals.spend / totals.leads : 0;
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  totals.cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
  totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  totals.convRate = totals.clicks > 0 ? (totals.leads / totals.clicks) * 100 : 0;
  totals.frequency = totals.reach > 0 ? totals.impressions / totals.reach : 0;

  return { totals, campaigns, adSets, ads, genders, ages };
}

/**
 * פלטת הגרפים של Tovno (Tovno-Claude-Color-Spec.md, סעיף 8).
 * הראשון הוא כחול המותג; השאר גוונים מובחנים לסדרות ללא משמעות ביצועית.
 */
export const COLORS = [
  '#315CF5','#12B89C','#7E6AD8','#FFBF32','#FC8792','#38A4F8',
  '#F97316','#B4233B','#0FB1B6','#84CC16','#C43B72','#26B99B',
];

/**
 * מקורות הגעה — מיפוי צבע קבוע לפי מקור, זהה בכל גרף ובכל מקרא (סעיף 8).
 *
 * למה מיפוי מפורש ולא אינדקס ב-COLORS: כשמסננים תקופה, מקור שנעלם מזיז את כל
 * מי שאחריו ברשימה, וצבע "פייסבוק" עובר לגוגל בין רינדורים. מיפוי לפי שם
 * המקור מקבע את הצבע ללא תלות בכמה סדרות יש ובאיזה סדר.
 *
 * מקור שאין לו התאמה חוזר null, והקורא נופל חזרה ל-COLORS לפי אינדקס.
 */
const SOURCE_COLORS = [
  [/facebook|פייסבוק|meta|instagram|אינסטגרם/i, '#315CF5'],
  [/google|גוגל/i,                              '#38A4F8'],
  [/אתר|site|web|landing|נחיתה/i,               '#12B89C'],
  [/מקורבים|referral|הפניות|חבר מביא/i,          '#FFBF32'],
  [/whatsapp|וואטסאפ|ווטסאפ/i,                   '#228B5A'],
];
export function sourceColor(name) {
  const n = String(name || '');
  for (const [re, color] of SOURCE_COLORS) if (re.test(n)) return color;
  return null;
}


export function mapCrmReportRows(jsonRows) {
  return jsonRows.map(row => {
    const address = findCol(row, ['כתובת/יישוב', 'כתובת', 'יישוב', 'עיר', 'city', 'address']) || '';
    const objections = findCol(row, ['התנגדויות', 'התנגדות', 'objections', 'objection']) || '';
    const lastMeeting = findCol(row, ['משימה/פגישה אחרונה', 'משימה', 'פגישה אחרונה', 'last meeting', 'last task']) || '';
    return { address, objections, lastMeeting };
  }).filter(r => r.address || r.objections || r.lastMeeting);
}

export function aggregateCrmReportRows(rows) {
  const cities = {};
  const objectionTypes = {};
  let withObjections = 0;
  let withMeeting = 0;

  rows.forEach(r => {
    const city = (r.address && r.address.trim()) || 'לא צוין';
    if (!cities[city]) cities[city] = { leads: 0, meetings: 0, contracts: 0 };

    // contractOnly rows are historic leads added solely for contract-city attribution
    if (!r.contractOnly) {
      cities[city].leads += 1;
    }

    if (r.lastMeeting && r.lastMeeting.trim()) {
      withMeeting++;
      cities[city].meetings += 1;
    }

    if (r.hasContract) {
      cities[city].contracts += 1;
    }

    if (r.objections && r.objections.trim()) {
      withObjections++;
      const obj = r.objections.trim();
      objectionTypes[obj] = (objectionTypes[obj] || 0) + 1;
    }
  });

  return {
    totals: {
      totalRows: rows.length,
      uniqueCities: Object.keys(cities).filter(c => c !== 'לא צוין').length,
      withObjections,
      withMeeting,
      objectionRate: rows.length > 0 ? (withObjections / rows.length * 100) : 0,
      meetingRate: rows.length > 0 ? (withMeeting / rows.length * 100) : 0,
    },
    cities,
    objectionTypes
  };
}

// ===== Recommendations 60-day rolling window =====
// Returns the YYYY-MM strings that cover the last 60 days, sorted oldest→newest.
// Used by the המלצות tab to aggregate data independently of selectedMonth.
export function getRecommendationsWindowMonths(daysBack = 60, today = new Date()) {
  const end = new Date(today)
  end.setHours(23, 59, 59, 999)
  const start = new Date(today)
  start.setDate(start.getDate() - daysBack)
  start.setHours(0, 0, 0, 0)
  // Collect every YYYY-MM that the [start..end] range touches
  const set = new Set()
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  const endCursor = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cursor <= endCursor) {
    const y = cursor.getFullYear()
    const m = String(cursor.getMonth() + 1).padStart(2, '0')
    set.add(`${y}-${m}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return [...set].sort()
}
