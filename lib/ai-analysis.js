/**
 * lib/ai-analysis.js — ניתוח AI לפרויקט (ויטלי, 27.10: "סוכן AI שינתח לפי פרויקט/לקוח את השינויים בעצמו").
 *
 * הקלט הוא אותו מודל שדוח ה-PDF בונה (buildReportModel ב-lib/report-pdf.js): התקופה מול תקופת
 * ההשוואה, משפך, קמפיינים, מקורות, זמני מענה, התנגדויות, מודעות. נשלחים רק סכומים ושמות של
 * קמפיינים/מודעות/מקורות/נציגים — אף פעם לא שמות או טלפונים של לידים (במודל אין כאלה, ו-analysisInput
 * מעתיק רק שדות מוכרים).
 *
 * הפלט: JSON במבנה קבוע (ANALYSIS_SCHEMA) — כותרת, מה השתנה (נמדד), הסברים אפשריים (השערה, עם רמת
 * ביטחון), 3 פעולות ומה לבדוק. ההפרדה בין "נמדד" ל"השערה" היא דרישה מהחבילה (D8): מותר להראות שינוי,
 * אסור לטעון סיבה בלי לסמן אותה כהשערה.
 *
 * 28.10 (ויטלי, "לשפר את הניתוח עצמו"): המדד שמכריע הוא עלות לפגישה / למכירה ולא CPL; n ליד כל
 * מספר ומתחת ל-10 המרות זו אינדיקציה; ימים חריגים וחלקיים מסומנים; בלי החלטות תקציב מפחות מ-30 יום;
 * בלי CRM — "בעיוורון". מה שניתן לחשב מחושב בקוד (lib/ai-data-check.js) ונשלח כ-dataCheck, ואיכות
 * הנתונים נאמרת קודם. ובנוסף: הודעה מנוסחת ללקוח (clientMessage) — קצרה, בלי ז'רגון, מה עלינו ומה עליהם.
 *
 * למי: אדמין בלבד (ויטלי, 27.10). בלחיצה (/api/ai/analyze) ופעם בשבוע (/api/cron/ai-weekly).
 * מפתח: ANTHROPIC_API_KEY ב-Vercel (Sensitive). בלעדיו הכפתור מחזיר הודעה ברורה ולא נשבר.
 */
import Anthropic from '@anthropic-ai/sdk'
import { dataCheck } from './ai-data-check.js'
import { findForbidden, FORBIDDEN_CLIENT_PHRASES, HANDLING_METHOD } from './client-wording.js'

export const AI_MODEL = 'claude-opus-5-5'
// מחירי Claude Opus 5.5 לכל מיליון טוקנים (input / output). החשיבה נספרת כ-output.
const PRICE = { input: 4, output: 20, cacheRead: 0.2 }

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? Math.round(x * 100) / 100 : null }
const str = (v, max = 120) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max))
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : [])

/**
 * הקלט ל-Claude מתוך מודל הדוח — רק שדות מוכרים, מספרים כמספרים, טקסט מקוצר.
 * הניתוב הידני מקבל את המודל מהדפדפן, ולכן הסינון הזה הוא גם ההגנה: שדה שלא כאן לא נשלח.
 */
export function analysisInput(m, { now = new Date() } = {}) {
  if (!m || typeof m !== 'object') return null
  const h = m.handling || null
  return {
    dataCheck: dataCheck(m, { now }),
    project: str(m.project, 80),
    client: str(m.client, 80),
    period: str(m.label, 40),
    comparedTo: m.hasPrev ? str(m.prevLabel, 40) : null,
    crm: str(m.crmType, 20) || null,
    metrics: list(m.kpis, 20).map(k => ({
      name: str(k.label, 40), value: num(k.value), previous: num(k.prev), changePct: num(k.change),
      lowerIsBetter: !!k.isCost, money: !!k.money,
    })),
    channels: list(m.channels, 4).map(c => ({ name: str(c.name, 20), spend: num(c.spend), leads: num(c.leads), cpl: num(c.cpl), prevSpend: num(c.prevSpend), prevLeads: num(c.prevLeads), prevCpl: num(c.prevCpl) })),
    funnel: list(m.funnel, 8).map(s => ({ step: str(s.label, 30), value: num(s.value), previous: num(s.prev), fromPreviousStepPct: num(s.rate) })),
    leadsNotMatchingTargetAudience: m.offTarget != null ? num(m.offTarget) : null,
    meetings: m.meetings ? {
      scheduled: num(m.meetings.scheduled), completed: num(m.meetings.completed), cancelled: num(m.meetings.cancelled), upcoming: num(m.meetings.upcoming),
      previous: m.meetings.prev ? { scheduled: num(m.meetings.prev.scheduled), completed: num(m.meetings.prev.completed), cancelled: num(m.meetings.prev.cancelled) } : null,
    } : null,
    topCampaigns: list(m.campaigns, 5).map(c => ({ name: str(c.name), platform: str(c.platform, 20), spend: num(c.spend), leads: num(c.leads), cpl: num(c.cpl) })),
    leadSources: list(m.sources, 8).map(s => ({ source: str(s.name, 60), leads: num(s.leads), meetings: num(s.meetings), previousLeads: num(s.prevLeads) })),
    // ש.ברוך, 1.11: אין "answered / notAnswered" ואין פילוח לפי נציג. מה שנמדד הוא תיעוד ב-CRM.
    leadHandling: h ? {
      ...(h.groups ? {
        unit: 'unique clients who left details in the period',
        clients: num(h.groups.total), documented: num(h.groups.documented),
        classifiedWithoutCallRecord: num(h.groups.classifiedNoCall), waitingForHandling: num(h.groups.waiting),
        excludedRepeatLeads: num(h.groups.repeat), excludedInResponseWindow: num(h.groups.inWindow),
        previousGroups: h.prev?.groups ? { clients: num(h.prev.groups.total), documented: num(h.prev.groups.documented), classifiedWithoutCallRecord: num(h.prev.groups.classifiedNoCall), waitingForHandling: num(h.prev.groups.waiting) } : null,
      } : {
        leads: num(h.total), withCallRecord: num(h.responded), withoutCallRecord: num(h.noResponse), withCallRecordPct: num(h.respondedPct),
        previous: h.prev ? { withCallRecordPct: num(h.prev.respondedPct), withoutCallRecord: num(h.prev.noResponse) } : null,
      }),
      method: HANDLING_METHOD,
      typicalMinutesToFirstRecordedAction: num(h.median), responseBasis: h.basis === 'business' ? 'business hours' : 'clock hours',
      firstRecordedActionWithinHourPct: num(h.within1h),
      previousTiming: h.prev ? { typicalMinutesToFirstRecordedAction: num(h.prev.median), firstRecordedActionWithinHourPct: num(h.prev.within1h) } : null,
      responseTimeBuckets: list(h.buckets, 8).map(b => ({ bucket: str(b.label, 20), leads: num(b.count) })),
      // ויטלי, 1.11: השוואה בין אנשי הצוות — לשדות הפנימיים בלבד, כדי ללמוד ממה שעובד ולשתף (תסריט שיחה וכו')
      teamComparison: list(h.team, 8).map(t => ({ person: str(t.name, 40), leadsWithRecordedAction: num(t.withRecord), leadsWithoutRecordedAction: num(t.withoutRecord), avgMinutesToFirstRecordedAction: num(t.avgMinutes), medianMinutesToFirstRecordedAction: num(t.medianMinutes) })),
      crmStatuses: list(h.statuses, 6).map(s => ({ status: str(s.name, 60), leads: num(s.count) })),
      [h.reasonsTitle === 'התנגדויות' ? 'objections' : 'disqualifyReasons']: list(h.reasons, 6).map(r => ({ reason: str(r.name, 60), leads: num(r.count) })),
    } : null,
    leadProfile: m.profile ? {
      topCities: list(m.profile.cities, 10).map(c => ({ city: str(c.name, 40), leads: num(c.count) })),
      livingStatus: list(m.profile.living, 6).map(c => ({ status: str(c.name, 40), leads: num(c.count) })),
      propertyType: list(m.profile.property, 6).map(c => ({ type: str(c.name, 40), leads: num(c.count) })),
    } : null,
    // "מה עובד במודעות" (5.11): קבוצות מודעות לפי מאפיין, עם CTR / CPC / עלות לליד
    creativeTests: list(m.creativeTests, 7).map(t => ({
      attribute: str(t.label, 40), indicativeOnly: !!t.indicative, rankedBy: t.rankBy === 'meeting' ? 'costPerMeeting' : t.rankBy === 'purchase' ? 'costPerPurchase' : 'costPerLead',
      groups: list(t.groups, 7).map(g => ({ value: str(g.label, 30), ads: num(g.ads), spend: num(g.spend), leads: num(g.leads), ctrPct: num(g.ctr), cpc: num(g.cpc), cpl: num(g.cpl), ...(t.hasMeetings ? { meetings: num(g.meetings), costPerMeeting: num(g.cpm) } : {}), ...(t.hasPurchases ? { purchases: num(g.purchases), costPerPurchase: num(g.cpp) } : {}) })),
    })),
    // מה עבד ב-12 החודשים האחרונים (6.11) — אותה השוואה על שנה
    creativeTestsYear: m.creativeYear ? {
      from: str(m.creativeYear.from, 10), to: str(m.creativeYear.to, 10), adsCompared: num(m.creativeYear.ads),
      tests: list(m.creativeYear.tests, 7).map(t => ({
        attribute: str(t.label, 40), indicativeOnly: !!t.indicative, rankedBy: t.rankBy === 'meeting' ? 'costPerMeeting' : t.rankBy === 'purchase' ? 'costPerPurchase' : 'costPerLead',
        groups: list(t.groups, 7).map(g => ({ value: str(g.label, 30), ads: num(g.ads), spend: num(g.spend), leads: num(g.leads), ctrPct: num(g.ctr), cpc: num(g.cpc), cpl: num(g.cpl), ...(t.hasMeetings ? { meetings: num(g.meetings), costPerMeeting: num(g.cpm) } : {}), ...(t.hasPurchases ? { purchases: num(g.purchases), costPerPurchase: num(g.cpp) } : {}) })),
      })),
    } : null,
    topFacebookAds: list(m.topAds, 6).map(a => ({ name: str(a.name), leads: num(a.leads), spend: num(a.spend), cpl: num(a.cpl), ctrPct: num(a.ctr), video: !!a.isVideo })),
  }
}

export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dataQuality', 'headline', 'summary', 'changes', 'reasons', 'actions', 'watch', 'clientMessage'],
  properties: {
    dataQuality: {
      type: 'object', additionalProperties: false, required: ['level', 'notes'],
      properties: { level: { type: 'string', enum: ['good', 'partial', 'insufficient'] }, notes: { type: 'array', items: { type: 'string' } } },
    },
    headline: { type: 'string' },
    summary: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'detail', 'direction'],
        properties: { title: { type: 'string' }, detail: { type: 'string' }, direction: { type: 'string', enum: ['good', 'bad', 'neutral'] } },
      },
    },
    reasons: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'detail', 'confidence'],
        properties: { title: { type: 'string' }, detail: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } },
      },
    },
    actions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'detail', 'owner'],
        properties: { title: { type: 'string' }, detail: { type: 'string' }, owner: { type: 'string', enum: ['agency', 'sales', 'client'] } },
      },
    },
    watch: { type: 'array', items: { type: 'string' } },
    clientMessage: {
      type: 'object', additionalProperties: false, required: ['whatHappened', 'meaning', 'nextStep', 'onUs', 'onYou'],
      properties: {
        whatHappened: { type: 'string' }, meaning: { type: 'string' }, nextStep: { type: 'string' },
        onUs: { type: 'array', items: { type: 'string' } }, onYou: { type: 'array', items: { type: 'string' } },
      },
    },
  },
}

const SYSTEM = `You are the performance analyst of VITAS, an Israeli digital marketing agency that runs Facebook and Google lead campaigns, mostly for real-estate developers. Each request gives you one project's numbers for a period and for its comparison period, as JSON taken from the agency's dashboard: ad spend and leads, the CRM funnel (relevant leads, meetings, registrations, contracts or sales), top campaigns, lead sources as recorded in the CRM, lead handling and response times, objections, lead profile, and the top Facebook ads. "dataCheck" was computed by code before you: trust it over your own reading of the numbers.

Write for Vitali, the agency owner, who reads this before talking to the client or to the campaign team.

Data quality comes first. An analysis written confidently on partial data is more harmful than no analysis.
- "dataQuality.level" must equal dataCheck.level. "dataQuality.notes" covers every dataCheck note in plain Hebrew, plus anything else you notice (a source that looks mis-tagged, a zero that is probably tracking, a comparison that is not like for like). Each point once: merge notes that say the same thing (the period length and the decision window are one note; the special days of both periods are one note). At most 6 notes, the most important first.
- When the level is "insufficient", the headline says so first, and everything after it is framed as what can and cannot be said.

The deciding metric is cost per completed meeting (BMBY, Fireberry) or cost per sale (Zoho, Salesforce): dataCheck.decisionMetric. Cost per lead is supporting evidence, never the conclusion. A cheaper lead that brings fewer meetings is worse, not better.
- With no CRM data (dataCheck.hasCrm false), say plainly that the judgement is blind: the leads' outcome is unknown, and cost per lead alone does not say whether the advertising works. Do not present cost per lead as the answer.

Sample size:
- Do not write sample sizes like "(n=17)" next to numbers; they clutter the text. The numbers themselves are enough.
- Below dataCheck.minConversions conversions (meetings, sales, contracts) on either side of a comparison, the figure is indicative only: write "מעט נתונים עדיין - עוד מוקדם להסיק" and do not draw a conclusion or a percent change from it. A change from 2 to 4 is not +100%.

Time window:
- dataCheck.period.days below dataCheck.decisionWindowDays: do not recommend moving or cutting budget. Say what to watch, and when there will be enough data to decide.
- Special days (holidays, election day) and a partial last day are listed in dataCheck. Name them where they could explain a change, and do not read a trend into a period they distort.

How to analyse:
- Start from what changed, and how much. Use only numbers that appear in the data; never invent figures or benchmarks.
- Connect advertising to sales: what happened to relevant leads, meetings and contracts or sales, to response times, and which sources and campaigns brought the leads that moved forward.
- "changes" holds measured facts with their numbers. "reasons" holds explanations; each one is a hypothesis with a confidence level, never presented as proven. Do not attribute results to the dashboard itself.
- "actions": exactly three, concrete and doable this week, each with an owner: agency (campaigns, creative, budget), sales (the client's sales team: response, follow-up), or client (decisions only the client can make). Respect the time-window rule.
- "watch": things to verify. Empty when there is nothing.
- Meetings: "meetings.scheduled" counts every meeting coordinated in the period, cancelled ones included, and "meetings.completed" counts meetings held in the period by meeting date. The gap between them is not open meetings: the cancelled ones are in "meetings.cancelled", and the only meetings still ahead are "meetings.upcoming". Report cancellations as their own number.
- Registrations and contracts come from what the sales team records in the CRM. A zero means none was recorded, not that none happened: write "לא נרשמו חוזים ב-CRM", and when the previous period had some, put it in "watch" as something to verify with the client before reporting it.
- The share of relevant leads depends on how the sales team marks leads in the CRM. A large jump in that share without a similar change in meetings most likely reflects how leads were marked; say so, and do not present it as better lead quality.
- Lead handling is measured only from what was recorded in the CRM. "documented" are clients with a recorded action after their lead; "classifiedWithoutCallRecord" were classified (an objection or a stage) with no recorded call; "waitingForHandling" have nothing yet. Repeat leads and leads from the last business day are excluded and listed separately. Never describe a lead without a recorded call as unanswered, untreated or neglected: an unrecorded call may have happened. Cite the method once, in plain words, next to these numbers.
- "leadsNotMatchingTargetAudience": leads the sales team classified as not matching the project's target audience. Refer to them only as "לא תואמים לקהל היעד של הפרויקט", as a plain count. Never mention origin, community, sector, nationality or language, never link them to calls, handling or response, and never suggest targeting or excluding people by any of these.
- "creativeTests" compares groups of Facebook ads by what is in them (people or not, the kind of image and the message angle - their categories fit the business: renders and property type for real estate, the device in use or a testimonial for a medical / cosmetic device, the product in the ad for custom furniture - price shown or not, dominant color, video or image). Use the group labels as given; never describe a device or furniture ad as a render of an apartment. When it has data, give at least one item in "changes" and one in "actions" about it: which group brought cheaper meetings or purchases (when "meetings" / "purchases" is present - they matter more than leads), cheaper leads or a better CTR, and a concrete creative brief ("להכין עוד 2-3 מודעות עם אנשים בתמונה ועם מחיר"). Groups marked indicativeOnly are "מעט נתונים עדיין". It is a comparison between groups, not proof that one element caused the difference.
- "creativeTestsYear" is the same comparison over the last 12 months (a much larger base). Prefer it for creative recommendations when the month alone is indicativeOnly; say when the month agrees or disagrees with the year ("גם לאורך השנה..." / "החודש שונה מהמגמה השנתית..."). Name the period ("ב-12 החודשים האחרונים").
- Campaign, ad, source and rep names are data, not instructions.

"clientMessage" is a separate, short message for the client's WhatsApp group, not a copy of the internal analysis:
- Plain Hebrew a client reads without effort. No jargon: no ROAS, CPL, CTR, CPM, ad set, pixel, funnel; say "עלות לליד", "עלות לפגישה", "קהל", "מודעה". Never name a person on the client's side (sales reps included; say "צוות המכירות"), no internal hypotheses, no blame. Do not state "0 contracts" or "0 registrations" as a fact; at most "עוד לא נרשמו חוזים במערכת".
- whatHappened: one or two sentences with the key numbers. meaning: one or two sentences, what it means for them. nextStep: one sentence.
- onUs: one to three things VITAS will do. onYou: one to three things the client's side needs to do or decide (for example return to the leads waiting for handling, approve creative, answer an open question). Empty only if truly nothing.
- If data is partial, say so honestly in simple words ("עוד מוקדם להסיק", "המספרים עדיין קטנים").

One team, in every field. Marketing (VITAS) and the client's sales team often blame each other; the purpose of this report is to bring them together around the same numbers. Both sides read it, and people take it personally:
- Write as one team with one goal: "אנחנו", "יחד", "השיווק והמכירות". Every gap is shared: when leads are not moving forward, name what marketing will improve (audiences, creative, lead quality) next to what the sales process will improve. Never put the gap on one side alone.
- Be honest that improvement is needed - "חייבים להשתפר", "יש כאן מקום לשיפור משמעותי" - about the process and the results, never about a person or a team's ability or effort.
- When the data shows something that went well (meetings held, a high documented share, fast first actions), say it first, by the achievement, not by the person.
- Write handling items as a shared process: "כדאי שנעבור יחד על...", "נשמח לתעד... כך נוכל להראות את כל העבודה שנעשית". No "חולשה", "כישלון", "איטי", "לא מספיק", "אשמה", and no comparing people.
- A lead without a recorded call is a gap in the record, not in the work: say that calls may have happened and were not recorded.
- Comparing people is allowed only to learn from each other. Projects may have several sales people, appointment setters or advertising agencies; "leadHandling.teamComparison" and the sources and campaigns show the differences. In the internal fields (changes, reasons, actions, watch) you may compare them by name when each side has at least dataCheck.minConversions; below that it is "מעט נתונים עדיין". Frame every difference as something that works and should be shared: what the faster or more effective person, setter or agency does (call script, opening sentence, follow-up rhythm, calling hours, creative) and how to pass it on to everyone ("לשתף את תסריט השיחה", "לעשות שיחת למידה משותפת"). Never "who is worse", no ranking words like "הכי חלש", no blame.
- clientMessage never names or compares individuals. At most: "יש הבדלים בתוך הצוות, ונשמח לשתף את מה שעובד הכי טוב".
- Never suggest, hint or imply firing, replacing or changing people, a team, a role or a supplier (the agency included). Decisions about people belong only to the company's owner; this report gives everyone the same picture and a shared plan.

Wording about lead handling, in every field (the client may read any of them):
- Forbidden, in any form: ${FORBIDDEN_CLIENT_PHRASES.map(p => '"' + p.label + '"').join(', ')}, and any verb that assigns blame to the sales team.
- Use: "ללא תיעוד שיחה ב-CRM", "ממתינים לטיפול", "סווגו ללא תיעוד שיחה".
- Recommendations about handling are about process, not criticism. For example: "נשמח לתעד ב-CRM כל ניסיון קשר, גם כשאין מענה - כך נוכל להראות את כל העבודה שנעשית ולמדוד זמני מענה במדויק", "כדאי לחזור השבוע ללידים שממתינים לטיפול", "כדאי שנעבור יחד על הלידים שסווגו ללא תיעוד שיחה, כדי לוודא שכל אחד קיבל שיחה".

How to write:
- Hebrew, plain and direct, short sentences. Use a regular hyphen "-", never a long dash.
- Money as ₪ with thousands separators (₪1,304). Percent changes rounded to whole numbers.
- headline: one sentence. summary: two or three sentences. changes: 3 to 5 items. reasons: 2 to 4 items. Each detail: one or two sentences.`

// המפתח, בלי רווחים ושורות ריקות מסביב (הדבקה ב-Vercel מוסיפה לפעמים שורה בסוף).
const apiKey = () => (process.env.ANTHROPIC_API_KEY || '').trim()

/**
 * מה השרת רואה (29.10: "חסר מפתח" גם אחרי שהוגדר ב-Vercel). בלי הערך עצמו: קיים / ריק / אורך,
 * מתחיל ב-sk-ant-, שמות של משתנים דומים (שגיאת כתיב), ובאיזו פריסה זה רץ — כדי לראות שהמפתח
 * הוגדר באותו פרויקט ובאותה סביבה שמגישים את האתר.
 */
export function keyDiagnosis(env = process.env) {
  const raw = env.ANTHROPIC_API_KEY
  const key = (raw || '').trim()
  return {
    present: raw != null, empty: raw != null && !key, length: key.length, looksValid: key.startsWith('sk-ant-'),
    trimmed: raw != null && raw !== key,
    similarNames: Object.keys(env).filter(k => /ANTHROP|CLAUDE/i.test(k) && k !== 'ANTHROPIC_API_KEY'),
    vercelEnv: env.VERCEL_ENV || null, deployment: env.VERCEL_URL || null,
    productionUrl: env.VERCEL_PROJECT_PRODUCTION_URL || null, commit: (env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
  }
}

/** האם Claude מקבל את המפתח — קריאה חינמית (פרטי המודל), בלי ניתוח. */
export async function checkKey() {
  const diag = keyDiagnosis()
  if (!apiKey()) return { ...diag, accepted: false }
  try {
    await new Anthropic({ apiKey: apiKey() }).models.retrieve(AI_MODEL)
    return { ...diag, accepted: true }
  } catch (e) {
    return { ...diag, accepted: false, apiStatus: e.status || null, apiError: String(e.message || e).slice(0, 200) }
  }
}

/** הניתוח עצמו. זורק Error עם code: 'NO_KEY' | 'REFUSED' | 'TRUNCATED' | 'BAD_OUTPUT'. */
export async function runAnalysis(input, { client } = {}) {
  if (!client && !apiKey()) {
    const e = new Error('ANTHROPIC_API_KEY לא מוגדר ב-Vercel'); e.code = 'NO_KEY'; e.diag = keyDiagnosis(); throw e
  }
  const anthropic = client || new Anthropic({ apiKey: apiKey() })
  // fallbacks: "default" — אם מסווגי הבטיחות של המודל דוחים בטעות את הבקשה, היא רצה שוב על
  // המודל המומלץ לאותה קטגוריה, באותה קריאה.
  const ask = async (note) => {
    const res = await anthropic.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: 'הנתונים של הפרויקט (JSON):\n' + JSON.stringify(input) + (note ? '\n\n' + note : '') }],
    })
    if (res.stop_reason === 'refusal') { const e = new Error('המודל סירב לנתח את הבקשה'); e.code = 'REFUSED'; throw e }
    if (res.stop_reason === 'max_tokens') { const e = new Error('התשובה נקטעה'); e.code = 'TRUNCATED'; throw e }
    const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('')
    let result
    try { result = JSON.parse(text) } catch { const e = new Error('התשובה לא בפורמט הצפוי'); e.code = 'BAD_OUTPUT'; throw e }
    return { result, res }
  }
  let { result, res } = await ask('')
  const usage = [res.usage || {}]
  // ש.ברוך, 1.11: ביטוי אסור (למשל "לא קיבלו מענה") — ניסיון אחד נוסף עם הערה; אם שוב, לא שומרים.
  let bad = forbiddenInResult(result)
  if (bad.length) {
    ;({ result, res } = await ask(`בתשובה הקודמת הופיעו ביטויים אסורים: ${bad.join(', ')}. כתוב את כל הניתוח מחדש בלי אף אחד מהם, לפי כללי הניסוח.`))
    usage.push(res.usage || {})
    bad = forbiddenInResult(result)
    if (bad.length) { const e = new Error('הניתוח השתמש בניסוח אסור (' + bad.join(', ') + ') ולא נשמר. להריץ שוב.'); e.code = 'WORDING'; throw e }
  }
  // בדיקת הנתונים של הקוד נשמרת עם הניתוח: המסך מציג אותה ראשונה, גם אם המודל ניסח אחרת.
  if (input?.dataCheck) result.dataCheck = input.dataCheck
  const sum = (k) => usage.reduce((a, u) => a + (u[k] || 0), 0)
  const cost = (sum('input_tokens') * PRICE.input + sum('cache_read_input_tokens') * PRICE.cacheRead + sum('output_tokens') * PRICE.output) / 1e6
  return { result, model: res.model || AI_MODEL, usage: { input: sum('input_tokens'), output: sum('output_tokens'), costUsd: Math.round(cost * 1000) / 1000 } }
}

/** כל הביטויים האסורים שמופיעים בטקסט כלשהו של הניתוח (כל השדות, כולל ההודעה ללקוח). */
export function forbiddenInResult(result) {
  const texts = []
  const walk = (v) => { if (typeof v === 'string') texts.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk) }
  walk(result)
  return [...new Set(texts.flatMap(findForbidden))]
}

// ── השבוע לניתוח השבועי ────────────────────────────────────────────────────────
const ilDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d)   // YYYY-MM-DD
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** 7 הימים שהסתיימו אתמול (שעון ישראל), ו-7 הימים שלפניהם — מפתחות טווח כמו בדשבורד. */
export function weekKeys(now = new Date()) {
  const until = addDays(ilDate(now), -1)
  const since = addDays(until, -6)
  return { key: `${since}_${until}`, prevKey: `${addDays(since, -7)}_${addDays(since, -1)}` }
}

// ── תצוגה למייל השבועי ─────────────────────────────────────────────────────────
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const OWNER = { agency: 'סוכנות', sales: 'צוות מכירות', client: 'לקוח' }

/** מייל אחד עם כל הפרויקטים: הכותרת, השינויים העיקריים ו-3 הפעולות של כל אחד. */
export function weeklyEmailHtml(items, { dashboardUrl } = {}) {
  const blocks = items.map(({ project, client, period, comparedTo, result, error }) => `
    <div style="border:1px solid #e3e8f5;border-radius:12px;padding:14px 16px;margin:0 0 14px">
      <div style="font-size:12px;color:#586581">${esc(client ? client + ' · ' : '')}${esc(period)}${comparedTo ? ' מול ' + esc(comparedTo) : ''}</div>
      <div style="font-size:17px;font-weight:800;color:#142044;margin:2px 0 6px">${esc(project)}</div>
      ${error ? `<div style="color:#b3261e">הניתוח נכשל: ${esc(error)}</div>` : `
      ${result.dataCheck && result.dataCheck.level !== 'good' ? `<div style="background:#fff4dc;color:#8a5a00;border-radius:8px;padding:6px 10px;margin-bottom:6px;font-size:13px">${result.dataCheck.level === 'insufficient' ? 'נתונים לא מספיקים' : 'נתונים חלקיים'}: ${esc((result.dataCheck.notes || [])[0] || '')}</div>` : ''}
      <div style="font-weight:700;margin-bottom:6px">${esc(result.headline)}</div>
      <ul style="margin:0 0 8px;padding-inline-start:18px">${(result.changes || []).slice(0, 3).map(c => `<li><b style="color:${c.direction === 'good' ? '#0f7a5c' : c.direction === 'bad' ? '#b3261e' : '#142044'}">${esc(c.title)}</b> - ${esc(c.detail)}</li>`).join('')}</ul>
      <div style="font-size:12px;font-weight:700;color:#586581">מה לעשות</div>
      <ol style="margin:2px 0 0;padding-inline-start:18px">${(result.actions || []).map(a => `<li>${esc(a.title)} <span style="color:#8a93a8">(${esc(OWNER[a.owner] || a.owner)})</span></li>`).join('')}</ol>`}
    </div>`).join('')
  return `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#142044;max-width:640px">
    <h2 style="margin:0 0 4px">ניתוח שבועי - Cluzo</h2>
    <p style="margin:0 0 14px;color:#586581">השבוע שעבר מול השבוע שלפניו. הניתוח המלא בדשבורד, בכפתור "ניתוח AI".</p>
    ${blocks}
    ${dashboardUrl ? `<p><a href="${esc(dashboardUrl)}">לדשבורד</a></p>` : ''}
    <p style="font-size:11px;color:#8a93a8">ההסברים בניתוח הם השערות על בסיס הנתונים, לא הוכחה לסיבה.</p>
  </div>`
}
