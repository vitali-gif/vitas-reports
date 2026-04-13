// ===== SHARED HELPERS =====

export function num(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

export function formatCurrency(n) {
  return '₪' + Number(n).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function formatNum(n) {
  return Number(n).toLocaleString('he-IL');
}

export function formatMonth(monthStr) {
  if (!monthStr) return '';
  const [y, m] = monthStr.split('-');
  const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  return months[parseInt(m) - 1] + ' ' + y;
}

export function getPrevMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  return prevY + '-' + String(prevM).padStart(2, '0');
}

export function changePercent(current, previous, isCost) {
  if (!previous || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const isGood = isCost ? pct <= 0 : pct >= 0;
  return { pct, isGood };
}

export function findCol(row, possibleNames) {
  const clean = s => s.replace(/[\u200e\u200f\u200b\u200c\u200d\u202a-\u202e\u2066-\u2069\ufeff]/g, '').toLowerCase().trim();
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
    campaign: findCol(row, ['campaign name', 'campaign', 'שם הקמפיין', 'שם קמפיין', 'Campaign name']),
    adSet: findCol(row, ['ad set name', 'ad set', 'שם סדרת המודעות', 'שם קבוצת מודעות', 'Ad set name', 'Ad Set Name']),
    adName: findCol(row, ['ad name', 'ad', 'שם המודעה', 'שם מודעה', 'Ad name', 'Ad Name']),
    adText: findCol(row, ['body', 'ad body', 'טקסט', 'body (dynamic creative)', 'Body', 'Body (Dynamic Creative)', 'Link message']),
    gender: findCol(row, ['gender', 'מגדר', 'Gender']),
    age: findCol(row, ['age', 'גיל', 'Age']),
    spend: findCol(row, ['amount spent (ils)', 'amount spent', 'spend', 'cost', 'הסכום ששולם (ILS)', 'הסכום ששולם', 'Amount spent (ILS)', 'Amount Spent (ILS)', 'Amount spent']),
    impressions: findCol(row, ['impressions', 'חשיפות', 'Impressions']),
    reach: findCol(row, ['reach', 'תפוצה', 'חשיפה ייחודית', 'Reach']),
    clicks: findCol(row, ['link clicks', 'clicks (all)', 'clicks', 'קליקים על קישור', 'Link clicks', 'Clicks (all)', 'Link Clicks']),
    leads: findCol(row, ['leads', 'results', 'תוצאות', 'לידים', 'Leads', 'Results', 'on-facebook leads', 'On-Facebook Leads', 'On-facebook leads']),
  })).filter(r => r.campaign || r.adSet || r.adName);
}

export function mapGoogleRows(jsonRows) {
  return jsonRows.map(row => ({
    campaign: findCol(row, ['campaign', 'Campaign', 'קמפיין']),
    adSet: findCol(row, ['ad group', 'Ad group', 'Ad Group', 'קבוצת מודעות']),
    adName: findCol(row, ['ad', 'Ad', 'מודעה', 'Headline 1']),
    adText: findCol(row, ['description', 'Description', 'Description 1']),
    gender: findCol(row, ['gender', 'Gender']),
    age: findCol(row, ['age', 'Age', 'Age range']),
    spend: findCol(row, ['cost', 'Cost', 'עלות']),
    impressions: findCol(row, ['impressions', 'Impressions', 'Impr.']),
    reach: findCol(row, ['reach', 'Reach']),
    clicks: findCol(row, ['clicks', 'Clicks']),
    leads: findCol(row, ['conversions', 'Conversions', 'המרות', 'leads', 'Leads']),
  })).filter(r => r.campaign || r.adSet || r.adName);
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
      if (!key) key = 'לא ידוע';
      if (!map[key]) map[key] = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 };
      map[key].spend += spend;
      map[key].impressions += impr;
      map[key].reach += reach;
      map[key].clicks += clicks;
      map[key].leads += leads;
    };

    add(campaigns, row.campaign);
    add(adSets, row.adSet);

    const adKey = row.adName || 'לא ידוע';
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

export const COLORS = [
  'rgba(59,130,246,0.7)', 'rgba(16,185,129,0.7)', 'rgba(139,92,246,0.7)',
  'rgba(245,158,11,0.7)', 'rgba(236,72,153,0.7)', 'rgba(6,182,212,0.7)',
  'rgba(239,68,68,0.7)', 'rgba(34,197,94,0.7)', 'rgba(168,85,247,0.7)',
  'rgba(251,146,60,0.7)', 'rgba(244,114,182,0.7)', 'rgba(14,165,233,0.7)',
];
