// e2e/tour.spec.mjs — סיור צילומי מסך בצד הלקוח, לעבודת עיצוב (לא בדיקה).
//
// רץ רק כש-QA_TOUR=1 (ב-Actions: QA → Run workflow → tour). מצלם את כל הטאבים של שני הפרויקטים
// הראשונים, ואת טאב הפתיחה של כל שאר הפרויקטים — בדסקטופ ובמובייל — ושומר ב-tour-shots/,
// שעולה כ-artifact נפרד. כך אפשר לראות "לפני" ו"אחרי" של שינוי עיצוב מול פרודקשן או preview,
// בלי סיסמה ביד.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const EMAIL = process.env.QA_CLIENT_EMAIL
const PASSWORD = process.env.QA_CLIENT_PASSWORD
const ON = process.env.QA_TOUR === '1' || process.env.QA_TOUR === 'true'
const OUT = path.resolve('tour-shots')
const FULL_TABS_PROJECTS = 2

const slug = (s) => String(s).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x'
const loader = (page) => page.getByRole('status', { name: /טוען/ })

async function settle(page) {
  await expect(loader(page)).toHaveCount(0, { timeout: 45_000 })
  await expect(page.getByText('מושכים נתונים לתקופה הזו')).toHaveCount(0, { timeout: 60_000 }).catch(() => {})
  await page.waitForTimeout(2500)   // גרפים ותמונות מודעות
}

async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true })
}

async function openPasswordForm(page) {
  const email = page.locator('input[type="email"]')
  if (await email.isVisible({ timeout: 2_000 }).catch(() => false)) return
  const toggle = page.getByRole('button', { name: 'כניסה עם סיסמה' })
  if (await toggle.isVisible({ timeout: 5_000 }).catch(() => false)) await toggle.click()
  await expect(email).toBeVisible({ timeout: 10_000 })
}

async function toggleSidebar(page, open) {
  const burger = page.getByRole('button', { name: 'פתח תפריט' })
  if (!(await burger.isVisible().catch(() => false))) return   // דסקטופ
  const overlay = page.locator('.sidebar-overlay.active')
  const isOpen = (await overlay.count()) > 0
  if (open && !isOpen) { await burger.click(); await expect(overlay).toHaveCount(1) }
  if (!open && isOpen) { await overlay.click({ position: { x: 8, y: 300 }, force: true }); await expect(overlay).toHaveCount(0) }
}

async function shootTabs(page, prefix) {
  const tabs = page.locator('.client-tabs').first().locator('.client-tab')
  const n = await tabs.count()
  for (let i = 0; i < n; i++) {
    const tab = tabs.nth(i)
    if (!(await tab.isVisible().catch(() => false))) continue
    const label = (await tab.innerText()).trim()
    await tab.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
    await tab.click()
    await settle(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    await shot(page, `${prefix}-t${i + 1}-${slug(label)}`)
  }
}

test.describe('סיור צילומי מסך', () => {
  test.skip(!ON || !EMAIL || !PASSWORD, 'רק עם QA_TOUR=1 ופרטי משתמש QA')
  test.setTimeout(15 * 60_000)

  test('כל הטאבים והפרויקטים', async ({ page }, info) => {
    const dev = info.project.name.includes('mobile') ? 'm' : 'd'
    await page.goto('/client')
    await expect(page.getByRole('heading', { name: 'ברוכים הבאים' })).toBeVisible({ timeout: 30_000 })
    await shot(page, `${dev}-00-login`)
    await openPasswordForm(page)
    await page.locator('input[type="email"]').fill(EMAIL)
    await page.locator('input[type="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'כניסה', exact: true }).click()
    await settle(page)
    const onboarding = page.getByRole('button', { name: /הבנתי, קדימה/ })
    if (await onboarding.isVisible({ timeout: 3000 }).catch(() => false)) {
      await shot(page, `${dev}-01-onboarding`)
      await onboarding.click()
    }
    await expect(page.locator('.client-tabs').first()).toBeVisible({ timeout: 30_000 })

    if (dev === 'm') {
      await toggleSidebar(page, true)
      await shot(page, `${dev}-02-sidebar`)
      await toggleSidebar(page, false)
    }

    const clients = page.locator('.client-header')
    const nClients = await clients.count()
    let done = 0
    for (let c = 0; c < nClients; c++) {
      await toggleSidebar(page, true)
      await clients.nth(c).click()
      const nProjects = await page.locator('.project-item:not(.locked)').count()
      for (let p = 0; p < nProjects; p++) {
        await toggleSidebar(page, true)
        if (!(await page.locator('.project-item:not(.locked)').nth(p).isVisible().catch(() => false))) await clients.nth(c).click()
        const item = page.locator('.project-item:not(.locked)').nth(p)
        const name = (await item.innerText()).trim()
        await item.click()
        await toggleSidebar(page, false)
        await settle(page)
        const prefix = `${dev}-p${String(done + 1).padStart(2, '0')}-${slug(name)}`
        if (done < FULL_TABS_PROJECTS && (dev === 'd' || done === 0)) await shootTabs(page, prefix)
        else if (dev === 'd') await shot(page, `${prefix}-t1`)
        done++
        if (dev === 'm' && done >= 1) return
      }
    }
  })
})
