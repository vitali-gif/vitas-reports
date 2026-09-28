#!/usr/bin/env node
/**
 * scripts/tests/fireberry-summary.smoke.mjs — הגדרות הספירה של Fireberry.
 *
 * הרשומות כאן הן בצורה האמיתית של ה-API (שמות pcfsystemfieldNNN וכל), כי בדיוק
 * שם נמצא הסיכון: שינוי שקט במיפוי השדות לא מפיל שום דבר — הוא רק מאפס מספרים.
 *
 * הרצה:  npm run test:fireberry
 */
import { computeFireberrySummary, filterLeads, fireberryConfigFor, clean, ymd } from '../../lib/crm/fireberry-summary.js'
import { metaSourcesForProject, metaAgencyOf, googleSourcesForProject, googleAgencyOf } from '../../lib/ads/routing.js'

let failures = 0
const ok = (cond, msg) => { if (cond) console.log('✓ ' + msg); else { console.error('✗ ' + msg); failures++ } }
const eq = (a, b, msg) => ok(a === b, `${msg} (התקבל ${JSON.stringify(a)}, ציפינו ${JSON.stringify(b)})`)

const VITAS = 'קמפיין השקה ויטאס & AllMarket'
const LAOS = 'קמפיין השקה לאוס'

const lead = (id, createdon, over = {}) => ({
  accountid: id, accountname: 'ליד ' + id, createdon,
  statuscode: 'חדש', originatingleadcode: 'פייסבוק',
  ownername: 'רועי בני', pcfsystemfield212name: '',
  pcfsystemfield174name: 'אקספו חיפה', campaignname: VITAS,
  pcfsystemfield185: 'Expo-Testing-9/2026-CON', pcfsystemfield186: 'קהל א', pcfsystemfield187: 'AD 1',
  pcfsystemfield210: 'דף נחיתה C', ...over,
})
const meeting = (id, leadId, createdon, scheduledstart, statuscode = '') =>
  ({ activityid: id, objectid: leadId, createdon, scheduledstart, statuscode, ownername: 'הודיה כהן' })

// ── סינון לפרויקט ולסוכנות ──────────────────────────────────────────────────
{
  const pool = [
    lead('a', '2026-09-10T09:00:00'),
    lead('b', '2026-09-11T09:00:00', { campaignname: LAOS, pcfsystemfield185: '' }),
    lead('c', '2026-09-12T09:00:00', { pcfsystemfield174name: 'אלפא טק' }),
    lead('d', '2026-09-13T09:00:00', { pcfsystemfield174name: '' }),
  ]
  const cfg = { project: 'אקספו חיפה', crmCampaign: VITAS }
  const got = filterLeads(pool, cfg).map(l => l.accountid)
  eq(got.join(','), 'a', 'סינון משאיר רק אקספו חיפה של ויטאס — לא לאוס, לא אלפא טק, לא ללא פרויקט')
  eq(filterLeads(pool, { project: 'אקספו חיפה' }).length, 2, 'בלי סינון קמפיין — גם לאוס נכנס')
}

// ── הפרויקט ב-Supabase ממופה ל-Fireberry ────────────────────────────────────
{
  const cfg = fireberryConfigFor('אקספו חיפה')
  ok(cfg && cfg.crmCampaign === VITAS, 'הפרויקט "אקספו חיפה" ממופה לקמפיין של ויטאס')
  ok(fireberryConfigFor('ONCE') === null, 'פרויקט של לקוח אחר אינו נמשך מ-Fireberry')
}

// ── לידים בטווח, רלוונטיות ─────────────────────────────────────────────────
{
  const leads = [
    lead('1', '2026-09-05T10:00:00'),
    lead('2', '2026-09-20T14:00:00', { statuscode: 'לא רלוונטי' }),
    lead('3', '2026-08-31T23:59:00'),                                   // לפני הטווח
    lead('4', '2026-10-01T00:01:00'),                                   // אחרי הטווח
    lead('5', '2026-09-21T10:00:00', { originatingleadcode: 'גוגל', pcfsystemfield185: 'expo_pmax' }),
  ]
  const R = computeFireberrySummary({ leads, meetings: [] }, { since: '2026-09-01', until: '2026-09-30', now: new Date('2026-09-30T23:00:00') })
  eq(R.totals.totalLeads, 3, 'נספרים רק לידים שנוצרו בתוך הטווח')
  eq(R.totals.nonRelevantLeads, 1, '"לא רלוונטי" נספר כלא רלוונטי')
  eq(R.totals.relevantLeads, 2, 'רלוונטיים = הכל פחות לא רלוונטיים')
  eq(R.sources['פייסבוק'].totalLeads, 2, 'פילוח מקור: פייסבוק')
  eq(R.sources['גוגל'].totalLeads, 1, 'פילוח מקור: גוגל')
  eq(R.adBreakdown.length, 2, 'פילוח מודעות: שתי מודעות שונות')
  eq(R.hourlyLeadStats[10], 2, 'שעת כניסת הליד נספרת')
  eq(R.xlsxRows.length, 3, 'שורות ה-Excel = הלידים בטווח')
  ok(!('טלפון' in R.xlsxRows[0]), 'אין טלפון בשורות ה-Excel')
}

// ── פגישות: תואמו לפי מועד התיאום, בוצעו לפי מועד הפגישה ────────────────────
{
  const leads = [lead('1', '2026-09-05T10:00:00'), lead('2', '2026-08-01T10:00:00')]
  const meetings = [
    meeting('m1', '1', '2026-09-10T11:00:00', '2026-10-12T09:00:00'),                  // תואמה בספטמבר, תתקיים באוקטובר
    meeting('m2', '1', '2026-09-11T11:00:00', '2026-09-15T09:00:00', 'התקיימה'),
    meeting('m3', '2', '2026-08-20T11:00:00', '2026-09-18T09:00:00', 'בוטלה'),          // תואמה באוגוסט, בוטלה בספטמבר
    meeting('m4', 'לא-שלנו', '2026-09-12T11:00:00', '2026-09-19T09:00:00', 'התקיימה'),  // ליד של פרויקט אחר
  ]
  const R = computeFireberrySummary({ leads, meetings }, { since: '2026-09-01', until: '2026-09-30', now: new Date('2026-09-30T23:00:00') })
  eq(R.totals.meetingsScheduled, 2, 'תואמו = פגישות שתואמו בטווח (כולל אחת שתתקיים בעתיד)')
  eq(R.totals.meetingsCompleted, 1, 'בוצעו = רק פגישה שסומנה "התקיימה" ומועדה בטווח')
  eq(R.totals.meetingsCancelled, 1, 'בוטלו נספרות לפי מועד הפגישה, גם אם תואמו קודם')
  eq(R.adBreakdown[0].meetings, 2, 'פגישות משויכות לצומת המודעה של הליד')
  eq(R.completedMeetings.length, 1, 'רשימת הפגישות שבוצעו')
  ok(R.completedMeetings[0].rep === 'הודיה כהן', 'שם הנציג נשמר על הפגישה שבוצעה')
}

// ── פגישה עתידית אינה "בוצעה", גם אם הטווח נמשך קדימה ───────────────────────
{
  const leads = [lead('1', '2026-09-05T10:00:00')]
  const meetings = [meeting('m1', '1', '2026-09-06T11:00:00', '2026-09-25T09:00:00', 'התקיימה')]
  const R = computeFireberrySummary({ leads, meetings }, { since: '2026-09-01', until: '2026-09-30', now: new Date('2026-09-20T12:00:00') })
  eq(R.totals.meetingsCompleted, 0, 'פגישה שמועדה אחרי היום אינה נספרת כבוצעה')
  eq(R.totals.meetingsScheduled, 1, 'אבל היא כן נספרת כתואמה')
}

// ── ניקוי תווי כיווניות ─────────────────────────────────────────────────────
{
  eq(clean('‏‎Expo-Testing‏'), 'Expo-Testing', 'תווי כיווניות מנוקים משמות')
  eq(ymd('2026-09-28T12:22:27'), '2026-09-28', 'תאריך נחתך מחותמת הזמן')
  const leads = [
    lead('1', '2026-09-05T10:00:00', { pcfsystemfield187: '‏AD 1‏' }),
    lead('2', '2026-09-06T10:00:00', { pcfsystemfield187: 'AD 1' }),
  ]
  const R = computeFireberrySummary({ leads, meetings: [] }, { since: '2026-09-01', until: '2026-09-30' })
  eq(R.adBreakdown.length, 1, 'אותה מודעה עם ובלי תווי כיווניות מתאחדת לשורה אחת')
}

// ── ניתוב המודעות: EXPO בלבד, בשני הערוצים ─────────────────────────────────
{
  const m = metaSourcesForProject('אקספו חיפה')
  ok(m, 'לאקספו חיפה יש כלל ניתוב במטא')
  eq(metaAgencyOf(m, { account: '1035178045330004', campaign: 'Expo-Testing-9/2026-CON' }), 'VITAS', 'מטא: קמפיין EXPO בחשבון של אלפא שייך לפרויקט')
  eq(metaAgencyOf(m, { account: '1035178045330004', campaign: 'Alpha-Tech-Leads' }), null, 'מטא: קמפיין של אלפא טק באותו חשבון אינו שייך')
  eq(metaAgencyOf(m, { account: '999', campaign: 'Expo-Testing' }), null, 'מטא: EXPO בחשבון אחר אינו שייך')

  const g = googleSourcesForProject('אקספו חיפה')
  ok(g, 'לאקספו חיפה יש כלל ניתוב בגוגל')
  eq(googleAgencyOf(g, { account: '9113178078', campaign: 'expo_pmax' }), 'VITAS', 'גוגל: קמפיין expo בחשבון הנכון שייך לפרויקט')
  eq(googleAgencyOf(g, { account: '9113178078', campaign: 'alphatech_search' }), null, 'גוגל: קמפיין אחר באותו חשבון אינו שייך')
}

// ── מזהה יציב לכל רשומה בתמונת המצב ─────────────────────────────────────────
// ב-28.9 כל 267 הלידים קיבלו אותו מזהה (גיבוב של שדות BMBY שכולם ריקים), ו-crm_raw
// החזיק ליד אחד. הדוח החודשי נראה תקין, וכל טווח תאריכים אחר הציג 1.
{
  const { extIdOf } = await import('../../lib/crm/raw-store.js')
  const a = extIdOf('leads', lead('acc-1', '2026-09-05T10:00:00'))
  const b = extIdOf('leads', lead('acc-2', '2026-09-06T10:00:00'))
  eq(a.id, 'acc-1', 'ליד: המזהה הוא accountid')
  ok(a.id !== b.id, 'שני לידים שונים מקבלים שני מזהים שונים')
  eq(a.field, 'accountid', 'ליד: לא נפל לגיבוב')
  const m = extIdOf('meetings', meeting('act-9', 'acc-1', '2026-09-10T11:00:00', '2026-09-12T09:00:00'))
  eq(m.id, 'act-9', 'פגישה: המזהה הוא activityid')
  // שלא נשבר דבר ל-Zoho: רשומה עם id ממשיכה להשתמש בו.
  eq(extIdOf('leads', { id: 'z1', accountid: 'x' }).id, 'z1', 'Zoho: id עדיין קודם ל-accountid')
}

console.log(failures === 0 ? '\n✓ Fireberry: הגדרות הספירה והניתוב תקינות' : `\n✗ ${failures} בדיקות נכשלו`)
process.exit(failures === 0 ? 0 : 1)
