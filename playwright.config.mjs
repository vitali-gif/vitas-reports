// playwright.config.mjs — בדיקות דפדפן (E2E) של VITAS Reports. ראו docs/qa.md.
//
// יעד הבדיקה נקבע ב-QA_BASE_URL (ברירת מחדל: פרודקשן). ל-preview של Vercel (מוגן ב-SSO)
// מצרפים כותרת עקיפה: VERCEL_AUTOMATION_BYPASS_SECRET (Project → Settings → Deployment Protection).
// כניסת לקוח: QA_CLIENT_EMAIL / QA_CLIENT_PASSWORD — משתמש QA ייעודי עם גישה לכל הפרויקטים.
import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.QA_BASE_URL || 'https://reports.vitas.co.il'
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    extraHTTPHeaders: bypass ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' } : {},
    // סביבות סנדבוקס עם proxy שמפענח TLS: PW_TRUST_SPKI = טביעות SPKI (base64, מופרדות בפסיק) של ה-CA
    // של ה-proxy. הדפדפן מאמין רק להן — לא כיבוי של אימות התעודות. בלי המשתנה אין שום שינוי.
    launchOptions: process.env.PW_TRUST_SPKI ? { args: [`--ignore-certificate-errors-spki-list=${process.env.PW_TRUST_SPKI}`] } : {},
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    // הלקוחות פותחים את הדוח בעיקר מהטלפון (PWA). אותן בדיקות, מסך צר.
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
})
