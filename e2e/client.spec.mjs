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
  await expect(page.locator('.client-tabs').first()).toBeVisible({ timeout })   // first: לחלק מהפרויקטים יש שורת תת-טאבים באותה מחלקה
}

/**
 * פותח את /client ומחכה למסך הכניסה. אם הדף הסטטי נשאר על "טוען..." (hydration לא קרה — למשל קובץ JS
 * שחזר 502 ברשת איטית), מנסים פעם אחת לטעון מחדש, כמו שמשתמש היה עושה, ומסמנים זאת בדוח.
 * בדיקות הרענון (למטה) נשארות קפדניות: שם אין ניסיון שני.
 */
async function gotoLogin(page) {
  await page.goto('/client')
  const heading = page.getByRole('heading', { name: 'כניסה לדוח' })
  if (await heading.isVisible({ timeout: 20_000 }).catch(() => false)) return
  test.info().annotations.push({ type: 'cold-load-retry', description: 'מסך הכניסה לא הופיע תוך 20 שניות — טעינה מחדש' })
  await page.reload()
  await expect(heading).toBeVisible({ timeout: 20_000 })
}

async function login(page) {
  await gotoLogin(page)
  await page.locator('input[type="email"]').fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'כניסה', exact: true }).click()
  await expectDashboard(page)
  await dismissOnboarding(page)
}

/** חלון ההדרכה מופיע בביקור הראשון בדפדפן (localStorage) ומכסה את הסיידבר והטאבים. */
async function dismissOnboarding(page) {
  const cta = page.getByRole('button', { name: /הבנתי, קדימה/ })
  if (await cta.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cta.click()
    await expect(cta).toBeHidden()
  }
}

/** הסיידבר על מובייל הוא מגירה שנפתחת מכפתור ההמבורגר; בדסקטופ הוא תמיד גלוי. */
async function openSidebarIfNeeded(page) {
  // במובייל הסיידבר קיים ב-DOM מחוץ למסך (transform), אז isVisible מחזיר true גם כשהוא סגור.
  // הסימן האמין: כפתור ההמבורגר מוצג רק במובייל, והמגירה פתוחה כשיש overlay פעיל.
  const toggle = page.getByRole('button', { name: 'פתח תפריט' })
  if (!(await toggle.isVisible().catch(() => false))) return   // דסקטופ
  const overlay = page.locator('.sidebar-overlay.active')
  if (await overlay.count()) return
  await toggle.click()
  await expect(overlay).toHaveCount(1)
  await expect(page.locator('.client-header').first()).toBeInViewport()
}

/** סוגר את המגירה במובייל (אם פתוחה) כדי שהתוכן מאחוריה יהיה נגיש ללחיצה ולבדיקה. */
async function closeSidebarIfOpen(page) {
  // כפתור ה-X נמצא בתוך המגירה שמונפשת החוצה, ולכן לא יציב ללחיצה; ה-overlay סוגר גם הוא ותמיד במקום.
  const overlay = page.locator('.sidebar-overlay.active')
  if (!(await overlay.count())) return
  await overlay.click({ position: { x: 8, y: 300 }, force: true })
  await expect(overlay).toHaveCount(0)
}

/** ערכי ה-KPI המוצגים כרגע. */
async function kpiTexts(page) {
  return (await page.locator('.kpi-value').allTextContents()).map(t => t.trim()).filter(Boolean)
}
const allZero = (texts) => texts.length > 0 && texts.every(t => /^[^\d]*0(\.00)?[^\d]*$/.test(t) || !/\d/.test(t))

test.describe('מסך הכניסה (ציבורי)', () => {
  test('נטען עם שדות מייל וסיסמה', async ({ page }) => {
    const errors = watchErrors(page)
    await gotoLogin(page)
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'כניסה', exact: true })).toBeDisabled()   // ריק → מושבת
    expect(errors).toEqual([])
  })

  test('סיסמה שגויה מציגה הודעה ברורה ולא נתקעת', async ({ page }) => {
    await gotoLogin(page)
    await page.locator('input[type="email"]').fill('qa-wrong-password@vitas.co.il')
    await page.locator('input[type="password"]').fill('definitely-wrong-password')
    await page.getByRole('button', { name: 'כניסה', exact: true }).click()
    await expect(page.getByText('מייל או סיסמה שגויים')).toBeVisible({ timeout: 20_000 })
  })
})

test.describe('צד הלקוח (מחובר)', () => {
  test.skip(!HAS_CREDS, 'דורש QA_CLIENT_EMAIL / QA_CLIENT_PASSWORD')

  test('בביקור ראשון מופיע חלון הדרכה, וסגירתו נזכרת ברענון', async ({ page }) => {
    await gotoLogin(page)
    await page.locator('input[type="email"]').fill(EMAIL)
    await page.locator('input[type="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'כניסה', exact: true }).click()
    await expectDashboard(page)
    const cta = page.getByRole('button', { name: /הבנתי, קדימה/ })
    await expect(cta).toBeVisible()
    await cta.click()
    await expect(cta).toBeHidden()
    await page.reload()
    await expectDashboard(page, { timeout: 20_000 })
    await expect(cta).toHaveCount(0)   // לא חוזר — היה באג של מודאל שחזר עשר פעמים
  })

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
    // רגרסיה 19.9: ברירת המחדל של התקופה הייתה הרבעון הבא (עתידי) — אפסים בכל הכרטיסים אצל כל לקוח.
    // כל בקשת נתונים לתקופה שמתחילה אחרי היום = כשל.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
    const futureRequests = []
    page.on('request', (r) => {
      const u = r.url()
      if (!u.includes('/api/reports/')) return
      const since = /[?&]since=(\d{4}-\d{2}-\d{2})/.exec(u)?.[1]
      const months = /[?&]dataForMonths=([^&]+)/.exec(u)?.[1]
      const starts = [since, ...(months ? decodeURIComponent(months).split(',').map(m => m.slice(0, 10)) : [])].filter(Boolean)
      if (starts.some(s => s > today)) futureRequests.push(u.replace(/^https?:\/\/[^/]+/, ''))
    })
    await login(page)
    await openSidebarIfNeeded(page)
    const clients = page.locator('.client-header')
    const nClients = await clients.count()
    expect(nClients, 'צריך לפחות לקוח אחד בסיידבר').toBeGreaterThan(0)
    const opened = [], zeros = []
    for (let c = 0; c < nClients; c++) {
      await openSidebarIfNeeded(page)
      await clients.nth(c).click()
      const nProjects = await page.locator('.project-item:not(.locked)').count()
      for (let p = 0; p < nProjects; p++) {
        await openSidebarIfNeeded(page)
        // אחרי לחיצה על לקוח אחר הרשימה מתחלפת — לוחצים שוב על הלקוח כדי שהפרויקטים שלו יוצגו.
        if (!(await page.locator('.project-item:not(.locked)').nth(p).isVisible().catch(() => false))) await clients.nth(c).click()
        const item = page.locator('.project-item:not(.locked)').nth(p)
        const name = (await item.innerText()).trim()
        await item.click()
        await closeSidebarIfOpen(page)
        await expectDashboard(page)
        // "מושכים נתונים לתקופה הזו" מותר לרגע — לא לדקה. ברירת המחדל חייבת להיות במטמון של הקרון.
        await expect(page.getByText('מושכים נתונים לתקופה הזו')).toHaveCount(0, { timeout: 60_000 })
        await expect(page.locator('.kpi-value').first()).toBeVisible({ timeout: 30_000 })
        opened.push(name)
        // כל הכרטיסים אפס = כמעט תמיד נתונים חסרים, לא לקוח בלי פעילות. לא מפיל (יש פרויקטי דמו/רדומים), אבל מדווח.
        if (allZero(await kpiTexts(page))) zeros.push(name)
      }
    }
    test.info().annotations.push({ type: 'projects', description: opened.join(', ') })
    if (zeros.length) test.info().annotations.push({ type: 'all-zero-kpis', description: zeros.join(', ') })
    expect(opened.length).toBeGreaterThan(0)
    expect(futureRequests, 'הדשבורד ביקש נתונים לתקופה עתידית').toEqual([])
    expect(errors).toEqual([])
  })

  test('כל הטאבים נפתחים בלי שגיאות JS', async ({ page }) => {
    const errors = watchErrors(page)
    await login(page)
    const tabs = page.locator('.client-tab')
    const n = await tabs.count()
    expect(n).toBeGreaterThanOrEqual(4)
    let clicked = 0
    for (let i = 0; i < n; i++) {
      const tab = tabs.nth(i)
      if (!(await tab.isVisible().catch(() => false))) continue   // במובייל טאב "המלצות" מוסתר בכוונה (display:none)
      await tab.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})   // שורת טאבים גוללת אופקית
      await tab.click()
      await expect(tab).toHaveClass(/active/)
      await expect(page.getByText('טוען...')).toHaveCount(0, { timeout: 30_000 })
      clicked++
    }
    expect(clicked).toBeGreaterThanOrEqual(4)
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
    await closeSidebarIfOpen(page)
    await expectDashboard(page)
    await page.reload()
    await expectDashboard(page, { timeout: 20_000 })
    await expect(page.locator('.kpi-value').first()).toBeVisible({ timeout: 60_000 })
    expect(errors).toEqual([])
  })
})
