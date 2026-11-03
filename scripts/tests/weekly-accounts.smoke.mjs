// scripts/tests/weekly-accounts.smoke.mjs — סטטוס שבועי של כל חשבונות הפרסום (lib/weekly-accounts.js)
import { sumWeek, compareAccount, weeklyAccountsEmailHtml } from '../../lib/weekly-accounts.js'

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

if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
