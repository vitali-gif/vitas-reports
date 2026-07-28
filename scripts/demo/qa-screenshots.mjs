/**
 * scripts/demo/qa-screenshots.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * QA ויזואלי אוטומטי לדמו.
 *
 * מריץ את הדשבורד האמיתי מול דאטהסט הדמו (בלי DB ובלי התחברות), עובר על כל
 * טאב ותת-טאב בכל שלוש התקופות, מצלם, ואוסף שגיאות קונסולה ותופעות "מסך ריק".
 *
 * למה זה שווה: בדיקות המספרים מוכיחות שהדאטהסט **עקבי**, אבל לא שהוא
 * **נראה טוב**. גרף ריק, טבלה שנחתכת או מודאל שלא נפתח יתגלו רק כאן.
 *
 * דרישות:  next dev רץ על PORT (ברירת מחדל 3300) + playwright מותקן.
 * הרצה:    node scripts/demo/qa-screenshots.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { DEMO_DATASET } from '../../lib/demo-dataset.js'

const PORT = process.env.PORT || 3300
const BASE = `http://127.0.0.1:${PORT}`
const OUT  = fileURLToPath(new URL('../../qa-screenshots/', import.meta.url))
const DEMO_PROJECT_ID = '00000000-0000-4000-8000-000000000001'

mkdirSync(OUT, { recursive: true })

// ── בניית התשובה שהדשבורד מצפה לה מ-/api/reports/by-project ────────────────
// אותו מבנה בדיוק: מערך שורות עם id/project_id/source/month/summary/data.
const REPORT_ROWS = DEMO_DATASET.reports.map((r, i) => ({
  id: `demo-row-${i + 1}`,
  project_id: DEMO_PROJECT_ID,
  source: r.source,
  month: r.month,
  summary: r.summary,
  data: r.data,
  created_at: new Date(2026, 6, 26).toISOString(),
}))

// התוויות חייבות להיות בדיוק כמו ב-MOBILE_PRESETS שב-app/components/shell/TitleBar.jsx
// שני בוררי תאריכים שונים לגמרי, עם תוויות שונות:
//   דסקטופ → app/components/shell/DatePicker.jsx    (פופאובר, החלה ב"עדכן")
//   מובייל  → app/components/shell/DateRangePicker.jsx (bottom-sheet, chip → "עדכן")
const PERIODS = [
  { id: 'current',  desktop: 'החודש הנוכחי',   mobile: 'החודש',     key: DEMO_DATASET.meta.periodKeys.current },
  { id: 'previous', desktop: 'חודש שעבר',      mobile: 'חודש שעבר', key: DEMO_DATASET.meta.periodKeys.previous },
  { id: 'q2',       desktop: 'Q2 — אפריל–יוני', mobile: 'Q2',        key: DEMO_DATASET.meta.periodKeys.q2 },
]

// הערה: 'Google PMax' ו-'Google Search' מותנים ב-source==='google_pmax'/'google_search',
// ששום route לא כותב (google/fetch כותב 'google'). הטאבים האלה לא מופיעים גם
// ללקוחות אמיתיים — ולכן הם לא ברשימה.
const MAIN_TABS = ['הכל', 'CRM', 'Facebook', 'Google', '💡 המלצות חכמות']
const CRM_SUBTABS = ['📂 מקורות הגעה', '⏱️ זמני תגובה', '🚫 התנגדויות', '🏘️ יישובים', '📅 פגישות שבוצעו']

const findings = []
const note = (level, where, msg) => findings.push({ level, where, msg })

// בסנדבוקס יש Chromium מותקן מראש בגרסה שלא בהכרח תואמת ל-playwright —
// מצביעים עליו ישירות במקום להוריד דפדפן חדש.
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium'
const browser = await chromium.launch({
  executablePath: EXEC,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
})

for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
  })

  // ברירת מחדל: הדאטהסט המקומי (בודק את מה שנבנה).
  // PROD=1: פרוקסי ל-reports.vitas.co.il עבור פרויקט הדמו — בודק בדיוק את מה
  // שהלקוח הפוטנציאלי יראה, כולל ה-seed שכבר נכתב ל-DB.
  const PROD = process.env.PROD === '1'
  const PROD_PID = process.env.PROD_PID || ''
  const ANON = process.env.ANON || ''
  await ctx.route('**/api/reports/by-project*', async (route) => {
    if (!PROD) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REPORT_ROWS) })
    const u = new URL(route.request().url())
    u.searchParams.set('projectId', PROD_PID)
    const res = await fetch('https://reports.vitas.co.il/api/reports/by-project' + u.search, { headers: { 'x-client-key': ANON } })
    const body = await res.text()
    // מזהה הפרויקט בתשובה חייב להתאים לזה שהעמוד המקומי מצפה לו
    route.fulfill({ status: res.status, contentType: 'application/json',
      body: body.split(PROD_PID).join(DEMO_PROJECT_ID) })
  })
  // חוסמים כל ניסיון משיכה חיה (כך גם מוודאים שהדמו לא תלוי בהם).
  for (const p of ['**/api/meta/**', '**/api/google/**', '**/api/bmby/**', '**/api/zoho/**', '**/api/salesforce/**', '**/api/ga4/**']) {
    await ctx.route(p, (route) => {
      note('warn', viewport.name, `הדשבורד ניסה למשוך נתונים חיים: ${route.request().url().replace(BASE, '')}`)
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"skipped":"demo"}' })
    })
  }

  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') note('error', viewport.name, `console: ${m.text().slice(0, 200)}`)
  })
  page.on('pageerror', (e) => note('error', viewport.name, `pageerror: ${String(e).slice(0, 200)}`))

  await page.goto(`${BASE}/demo-preview`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(2500)

  /**
   * צילום מסך.
   * `fullPage: true` משנה זמנית את גובה ה-viewport, מה שמפעיל resize של
   * Chart.js — והצילום נתפס באמצע הפריסה מחדש, כך שהעמודות מצטופפות בצד
   * אחד בעוד הצירים כבר נפרסו. התוצאה נראית כמו באג רינדור אמיתי, והיא
   * ארטיפקט של הצילום בלבד. לכן: מגדילים את ה-viewport, נותנים לגרפים
   * להתייצב, ורק אז מצלמים.
   */
  const shot = async (name) => {
    const file = join(OUT, `${viewport.name}-${name}.png`)
    const h = await page.evaluate(() => Math.min(6000, document.body.scrollHeight))
    await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, h) })
    await page.waitForTimeout(700)
    await page.screenshot({ path: file })
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.waitForTimeout(250)
    return file
  }

  /** לחיצה על טאב לפי טקסט; מחזיר false אם הטאב לא קיים. */
  const clickTab = async (text) => {
    const el = page.locator('button.client-tab').filter({ hasText: text }).first()
    if (!(await el.count())) return false
    await el.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(1400)
    return true
  }

  /** בחירת תקופה — שני מסלולים, לפי הבורר שמוצג ב-viewport הנוכחי. */
  const selectPeriod = async (period) => {
    if (viewport.name === 'mobile') {
      const pill = page.locator('.drp-pill').first()
      if (!(await pill.count())) { note('error', viewport.name, 'בורר התאריכים (.drp-pill) לא נמצא'); return false }
      await pill.click({ timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(700)
      const chip = page.locator('.drp-chip').filter({ hasText: new RegExp(`^\\s*${period.mobile}\\s*$`) }).first()
      if (!(await chip.count())) {
        note('error', viewport.name, `chip "${period.mobile}" לא נמצא`)
        await page.keyboard.press('Escape').catch(() => {}); return false
      }
      await chip.click({ timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(400)
      // ה-chip קובע רק טיוטה — ההחלה היא בכפתור "עדכן"
      const confirm = page.locator('.drp-btn-primary').first()
      if (await confirm.count()) await confirm.click({ timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(2800)
      return true
    }

    // דסקטופ: הטריגר בתוך .drp-desktop-only, ואז כפתור התווית, ואז "עדכן"
    const trigger = page.locator('.drp-desktop-only button').first()
    if (!(await trigger.count())) { note('error', viewport.name, 'טריגר בורר התאריכים לא נמצא'); return false }
    await trigger.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(700)
    const btn = page.locator('button').filter({ hasText: new RegExp(`^\\s*${period.desktop.replace(/[-—–]/g, '.')}\\s*$`) }).first()
    if (!(await btn.count())) {
      note('error', viewport.name, `כפתור תקופה "${period.desktop}" לא נמצא`)
      await page.keyboard.press('Escape').catch(() => {}); return false
    }
    await btn.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(400)
    const apply = page.locator('button').filter({ hasText: /^\s*עדכן\s*$/ }).first()
    if (await apply.count()) await apply.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(2800)
    return true
  }

  for (const period of PERIODS) {
    if (!(await selectPeriod(period))) continue
    // אימות אמיתי: הדשבורד באמת עבר לתקופה הזו?
    const shown = await page.evaluate(() => document.body.innerText)
    if (period.id === 'q2' && !/אפריל|04|Q2/.test(shown)) {
      note('warn', viewport.name, 'לא ברור שהמעבר ל-Q2 בוצע')
    }

    for (const tab of MAIN_TABS) {
      const ok = await clickTab(tab)
      if (!ok) { note('warn', viewport.name, `${period.id}: טאב "${tab}" לא קיים`); continue }

      const slug = `${period.id}-${tab.replace(/[^\wא-ת]+/g, '_')}`
      await shot(slug)

      // בדיקת "מסך ריק"
      const bodyText = (await page.locator('.main-content').innerText().catch(() => '')) || ''
      if (bodyText.includes('אין נתונים לטווח התאריכים')) {
        note('error', viewport.name, `${period.id}/${tab}: "אין נתונים לטווח התאריכים"`)
      }
      if (bodyText.trim().length < 120) {
        note('error', viewport.name, `${period.id}/${tab}: העמוד כמעט ריק (${bodyText.trim().length} תווים)`)
      }

      // גרפים: canvas בגודל 0 = גרף שלא צויר
      const emptyCanvas = await page.evaluate(() => {
        const cs = [...document.querySelectorAll('canvas')]
        return cs.filter(c => c.offsetParent !== null && (c.width < 5 || c.height < 5)).length
      })
      if (emptyCanvas > 0) note('warn', viewport.name, `${period.id}/${tab}: ${emptyCanvas} גרפים ריקים`)

      // תתי-טאבים של CRM
      if (tab === 'CRM') {
        for (const sub of CRM_SUBTABS) {
          const ok2 = await clickTab(sub)
          if (!ok2) { note('warn', viewport.name, `${period.id}: תת-טאב "${sub}" לא קיים`); continue }
          await shot(`${period.id}-CRM-${sub.replace(/[^\wא-ת]+/g, '_')}`)
          const t = (await page.locator('.main-content').innerText().catch(() => '')) || ''
          if (/אין .{0,20}לתקופה זו/.test(t)) {
            note('error', viewport.name, `${period.id}/CRM/${sub}: מצב ריק`)
          }
        }
        await clickTab('📂 מקורות הגעה')
      }
    }
  }

  // מודאל שמות הלידים — הפיצ'ר שהכי קל לשבור
  await clickTab('הכל')
  const leadCard = page.locator('.kpi-card, .kpi').filter({ hasText: 'לידים' }).first()
  if (await leadCard.count()) {
    await leadCard.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(900)
    const modal = await page.locator('text=/רשימת|שמות/i').count()
    await shot('modal-leads')
    if (!modal) note('warn', viewport.name, 'לחיצה על כרטיס הלידים לא פתחה מודאל')
    await page.keyboard.press('Escape').catch(() => {})
  } else {
    note('warn', viewport.name, 'לא נמצא כרטיס KPI של לידים')
  }

  await ctx.close()
}

await browser.close()

// ── דוח ─────────────────────────────────────────────────────────────────────
const errs  = findings.filter(f => f.level === 'error')
const warns = findings.filter(f => f.level === 'warn')

// איחוד הודעות זהות
const dedupe = (arr) => {
  const m = new Map()
  for (const f of arr) {
    const k = `${f.where}|${f.msg}`
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()].map(([k, n]) => ({ line: k.replace('|', ' — '), n }))
}

let out = '# QA ויזואלי — פרויקט הדמו\n\n'
out += `צילומים: \`qa-screenshots/\`\n\n`
out += `- שגיאות: ${errs.length}\n- אזהרות: ${warns.length}\n\n`
if (errs.length)  { out += '## שגיאות\n\n'; for (const d of dedupe(errs))  out += `- ${d.line}${d.n > 1 ? ` (×${d.n})` : ''}\n` }
if (warns.length) { out += '\n## אזהרות\n\n'; for (const d of dedupe(warns)) out += `- ${d.line}${d.n > 1 ? ` (×${d.n})` : ''}\n` }
if (!errs.length && !warns.length) out += '✅ לא נמצאו בעיות.\n'

writeFileSync(join(OUT, 'REPORT.md'), out, 'utf8')
console.log(out)
process.exitCode = errs.length ? 1 : 0
