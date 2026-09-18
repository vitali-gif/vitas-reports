// e2e/client.spec.mjs — מה שלקוח רואה: כניסה, כל פרויקט נפתח, טאבים, רענון.
//
// כל באג שלקוח פגש הופך לבדיקה כאן. עד עכשיו:
//   18.9  רענון העמוד באפליקציה נתקע על "טוען..." לנצח (deadlock של getSession בתוך onAuthStateChange).
//         → "רענון חוזר לא נתקע על טוען...".
//   17.9  "אין גישה" בפתיחה מהרקע כשהטוקן פג לפני הרענון → apiFetch מנסה שוב אחרי 401.
//         → כל בדיקת כניסה בודקת שלא מופיע "אין גישה".
//
// הרצה מקומית:  QA_CLIENT_EMAIL=... QA_CLIENT_PASSWORD=... npx playwright test
// בלי פרטי כניסה רצות רק הבדיקות הציבוריות (מסך הכניסה).
import { test, expect } from '@playwright/test'

const EMAIL = process.env.QA_CLIENT_EMAIL
const PASSWORD = process.env.QA_CLIENT_PASSWORD
const HAS_CREDS = !!(EMAIL && PASSWORD)

/** שגיאות JS לא תפוסות ותשובות 5xx מה-API — נאספות לכל בדיקה ונבדקות בסופה. */
function watchErrors(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('response', (r) => { if (r.status() >= 500 && r.url().includes('/api/')) errors.push(`HTTP ${r.status()} ${r.url()}`) })
  return errors
}

/** ממתין שהמסך יגיע למצב יציב: לא "טוען...", לא "אין גישה", והדשבורד (שורת הטאבים) מוצג. */
async function expectDashboard(page, { timeout = 30_000 } = {}) {
  await expect(page.getByText('טוען...'), 'הספינר הראשי חייב להיעלם').toHaveCount(0, { timeout })
  await expect(page.getByText('אין גישה'), 'ללקוח עם הרשאות אסור לראות "אין גישה"').toHaveCount(0)
  await expect(page.locator('.client-tabs')).toBeVisible({ timeout })
}

async function login(page) {
  await page.goto('/client')
  await expect(page.getByRole('heading', { name: 'כניסה לדוח' })).toBeVisible()
  await page.locator('input[type="email"]').fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'כניסה', exact: true }).click()
  await expectDashboard(page)
}

/** הסיידבר על מובייל נפתח מכפתור; בדסקטופ הוא תמיד גלוי. מחזיר את רשימת הפרויקטים הזמינים. */
async function openSidebarIfNeeded(page) {
  const sidebar = page.locator('.sidebar-inner')
  if (await sidebar.isVisible().catch(() => false)) return
  const toggle = page.locator('[aria-label*="תפריט"], [aria-label*="menu" i], .menu-btn, .hamburger').first()
  if (await toggle.isVisible().catch(() => false)) await toggle.click()
}

test.describe('מסך הכניסה (ציבורי)', () => {
  test('נטען עם שדות מייל וסיסמה', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/client')
    await expect(page.getByRole('heading', { name: 'כניסה לדוח' })).toBeVisible()
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'כניסה', exact: true })).toBeDisabled()   // ריק → מושבת
    expect(errors).toEqual([])
  })

  test('סיסמה שגויה מציגה הודעה ברורה ולא נתקעת', async ({ page }) => {
    await page.goto('/client')
    await page.locator('input[type="email"]').fill('qa-wrong-password@vitas.co.il')
    await page.locator('input[type="password"]').fill('definitely-wrong-password')
    await page.getByRole('button', { name: 'כניסה', exact: true }).click()
    await expect(page.getByText('מייל או סיסמה שגויים')).toBeVisible({ timeout: 20_000 })
  })
})

test.describe('צד הלקוח (מחובר)', () => {
  test.skip(!HAS_CREDS, 'דורש QA_CLIENT_EMAIL / QA_CLIENT_PASSWORD')

  test('כניסה מגיעה לדשבורד עם מספרים בכרטיסי ה-KPI', async ({ page }) => {
    const errors = watchErrors(page)
    await login(page)
    const kpis = page.locator('.kpi-value')
    await expect(kpis.first()).toBeVisible({ timeout: 60_000 })
    // לפחות כרטיס אחד עם ספרה — לא מסך של "אין נתון" בלבד.
    await expect.poll(async () => (await kpis.allTextContents()).some(t => /\d/.test(t)), { timeout: 60_000 }).toBe(true)
    expect(errors).toEqual([])
  })

  test('כל פרויקט בסיידבר נפתח', async ({ page }) => {
    const errors = watchErrors(page)
    await login(page)
    await openSidebarIfNeeded(page)
    const clients = page.locator('.client-header')
    const nClients = await clients.count()
    expect(nClients, 'צריך לפחות לקוח אחד בסיידבר').toBeGreaterThan(0)
    const opened = []
    for (let c = 0; c < nClients; c++) {
      await openSidebarIfNeeded(page)
      await clients.nth(c).click()
      const projects = page.locator('.project-item:not(.locked)')
      const nProjects = await projects.count()
      for (let p = 0; p < nProjects; p++) {
        await openSidebarIfNeeded(page)
        const item = page.locator('.project-item:not(.locked)').nth(p)
        const name = (await item.innerText()).trim()
        await item.click()
        await expectDashboard(page)
        // "מושכים נתונים לתקופה הזו" מותר לרגע — לא לדקה. ברירת המחדל (החודש הנוכחי) חייבת להיות במטמון.
        await expect(page.getByText('מושכים נתונים לתקופה הזו')).toHaveCount(0, { timeout: 60_000 })
        await expect(page.locator('.kpi-value').first()).toBeVisible({ timeout: 30_000 })
        opened.push(name)
      }
    }
    test.info().annotations.push({ type: 'projects', description: opened.join(', ') })
    expect(opened.length).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })

  test('כל הטאבים נפתחים בלי שגיאות JS', async ({ page }) => {
    const errors = watchErrors(page)
    await login(page)
    const tabs = page.locator('.client-tab')
    const n = await tabs.count()
    expect(n).toBeGreaterThanOrEqual(4)
    for (let i = 0; i < n; i++) {
      await tabs.nth(i).click()
      await expect(tabs.nth(i)).toHaveClass(/active/)
      await expect(page.getByText('טוען...')).toHaveCount(0, { timeout: 30_000 })
    }
    expect(errors).toEqual([])
  })

  test('רענון חוזר לא נתקע על "טוען..." (רגרסיה 18.9)', async ({ page }) => {
    const errors = watchErrors(page)
    await login(page)
    for (let i = 1; i <= 5; i++) {
      await page.reload()
      await expectDashboard(page, { timeout: 20_000 })
    }
    expect(errors).toEqual([])
  })

  test('מעבר ללקוח אחר ואז רענון שומר על הדשבורד (רגרסיה 18.9)', async ({ page }) => {
    const errors = watchErrors(page)
    await login(page)
    await openSidebarIfNeeded(page)
    const clients = page.locator('.client-header')
    const n = await clients.count()
    test.skip(n < 2, 'למשתמש ה-QA יש לקוח אחד בלבד')
    await clients.nth(n - 1).click()
    await page.locator('.project-item:not(.locked)').first().click()
    await expectDashboard(page)
    await page.reload()
    await expectDashboard(page, { timeout: 20_000 })
    await expect(page.locator('.kpi-value').first()).toBeVisible({ timeout: 60_000 })
    expect(errors).toEqual([])
  })
})
