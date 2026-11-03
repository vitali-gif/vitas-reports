// scripts/tests/weekly-accounts.smoke.mjs — סטטוס שבועי של כל חשבונות הפרסום (lib/weekly-accounts.js)
import { sumWeek, compareAccount, weeklyAccountsEmailHtml, ruleFor, applyRule } from '../../lib/weekly-accounts.js'
import { ACCOUNT_RULES } from '../../lib/weekly-accounts-config.js'

const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log((ok ? '✓ ' : '✗ ') + name + (ok ? '' : `: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`))
  if (!ok) process.exitCode = 1
}
const W = (spend, leads) => ({ spend, leads, clicks: 0, impressions: 0 })

eq('sum of rows', sumWeek([{ spend: 100, leads: 2 }, { spend: 50.5, leads: 1, clicks: 3 }]), { spend: 150.5, leads: 3, clicks: 3, impressions: 0 })
eq('steady account: no flags', compareAccount({ cur: W(1000, 20), prev: W(1000, 21) }).flags, [])
eq('stopped', compareAccount({ cur: W(0, 0), prev: W(800, 10) }).flags, ['הפרסום נעצר השבוע'])
eq('started', compareAccount({ cur: W(500, 6), prev: W(0, 0) }).flags, ['התחיל לפרסם השבוע'])
eq('spend without leads', compareAccount({ cur: W(400, 0), prev: W(400, 5) }).flags, ['אין לידים השבוע'])
const up = compareAccount({ cur: W(1500, 10), prev: W(1000, 20) })
eq('CPL up 200%, leads down 50%', [up.flags, Math.round(up.cpl), Math.round(up.change.cpl)], [['עלות לליד עלתה 200%', 'לידים ירדו 50%'], 150, 200])
eq('small numbers: no CPL flag under 5 leads', compareAccount({ cur: W(600, 2), prev: W(300, 3) }).flags, [])
eq('disabled account that spent last week', compareAccount({ cur: W(0, 0), prev: W(200, 3), status: 'disabled' }).flags, ['החשבון לא פעיל (מושבת או סגור)', 'הפרסום נעצר השבוע'])

const html = weeklyAccountsEmailHtml({
  accounts: [
    { platform: 'meta', name: 'ש.ברוך <2026>', cmp: up },
    { platform: 'meta', name: 'Alpha', cmp: compareAccount({ cur: W(2000, 40), prev: W(1800, 38) }) },
    { platform: 'google', name: 'HI PARK', cmp: compareAccount({ cur: W(900, 12), prev: W(950, 11) }) },
  ],
  errors: [{ platform: 'google', name: 'X', error: 'PERMISSION_DENIED' }],
  weekLabel: '26.10-1.11', prevLabel: '19.10-25.10',
})
eq('email: attention box, both platforms, totals, escaped names, errors', [html.includes('דורש תשומת לב (1)'), html.includes('פייסבוק / אינסטגרם (2)'), html.includes('גוגל (1)'), html.includes('סה"כ'), html.includes('&lt;2026&gt;'), html.includes('PERMISSION_DENIED')], [true, true, true, true, true, true])

// כללי החשבונות של ויטלי (3.11)
const R = (campaign, week, spend, leads) => ({ campaign, week, spend, leads, clicks: 0, impressions: 0 })
eq('excluded: Shami (meta id), Google by name', [ruleFor(ACCOUNT_RULES, 'meta', '395927933298639', 'Shami')?.exclude, ['גשם החזקות- נהריה', 'שמי אחזקות ויזמות 2010 בעמ', 'זולה - חדרים שילדים אוהבים', 'Epilady', 'אמפיירטק'].every(n => ruleFor(ACCOUNT_RULES, 'google', '1', n)?.exclude), ruleFor(ACCOUNT_RULES, 'google', '1', 'שמואל ברוך יזמות ובניה בע"מ')], [true, true, null])
const alpha = applyRule(ruleFor(ACCOUNT_RULES, 'meta', '1035178045330004', 'Alpha'), 'Alpha', [R('\u200f\u200eExpo-Testing-9/2026-CON', 'cur', 1000, 10), R('Alpha- droshim Sales man-6/2026-LeadG', 'cur', 500, 20)])
eq('Alpha: Expo campaigns only', alpha.map(a => [a.name, a.cur.spend, a.cur.leads]), [['Alpha - אקספו', 1000, 10]])
const shb = applyRule(ruleFor(ACCOUNT_RULES, 'google', '5213006256', 'x'), 'x', [R('\u200fOnce-Shalmo 10% Hon-7/2026-Pmax', 'cur', 100, 2), R('Hi Park-4/2026-Pmax', 'prev', 50, 1), R('Rehavia-Testing', 'cur', 30, 1), R('Brand', 'cur', 5, 0)])
eq('ש.ברוך: split into 3 projects + other', shb.map(a => [a.name, a.cur.spend, a.prev.spend]), [['ש.ברוך - ONCE', 100, 0], ['ש.ברוך - HI PARK', 0, 50], ['ש.ברוך - REHAVIA', 30, 0], ['ש.ברוך - אחר', 5, 0]])
eq('no rule: one row under the account name', applyRule(null, 'Kloss', [R('a', 'cur', 10, 1)]).map(a => a.name), ['Kloss'])

if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
