/** @type {import('next').NextConfig} */

// כותרות אבטחה. עד עכשיו התשובות נשאו רק HSTS (מ-Vercel), כך שאפשר היה
// להטמיע את הדשבורד ב-iframe באתר זר.
//
// CSP מלא לא נכלל כאן בכוונה: הדף טוען Google Fonts ו-Supabase, ומדיניות שגויה
// שוברת אותם בשקט. התבנית למטה היא נקודת ההתחלה — להפעיל אותה קודם כ-
// Content-Security-Policy-Report-Only ולבדוק את הקונסול לפני שאוכפים.
//
//   default-src 'self';
//   script-src 'self' 'unsafe-inline';
//   style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
//   font-src 'self' https://fonts.gstatic.com;
//   img-src 'self' data: blob: https:;
//   connect-src 'self' https://*.supabase.co;
//   frame-ancestors 'none';
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
]

// עמוד הבית (/) מוגש מהמאגר cluzo-site — פרויקט Vercel נפרד (Next.js multi-zones).
// CLUZO_SITE_URL = הכתובת של הפרויקט הזה ב-Vercel, בלי / בסוף. כל הנכסים של האתר
// יושבים תחת /site-assets (ראה cluzo-site/next.config.js), כדי לא להתנגש ב-/_next
// של הדשבורד. כשהמשתנה לא מוגדר — app/page.js המקומי מוצג כמו קודם, כגיבוי,
// כדי שהעמוד שגוגל בודקת לא ייעלם.
const CLUZO_SITE_URL = (process.env.CLUZO_SITE_URL || '').replace(/\/+$/, '')

const nextConfig = {
  reactStrictMode: true,
  // דוח ה-PDF החודשי (app/api/cron/monthly-report): Chromium בשרת. החבילות לא נארזות ב-webpack,
  // והקובץ הבינארי (bin/*.br, נקרא מהדיסק) נכלל במפורש בפונקציה — אחרת הוא לא מגיע ל-Vercel.
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
    outputFileTracingIncludes: {
      '/api/cron/monthly-report': ['./node_modules/@sparticuz/chromium/bin/**'],
    },
  },
  async rewrites() {
    if (!CLUZO_SITE_URL) return []
    return {
      beforeFiles: [
        { source: '/', destination: `${CLUZO_SITE_URL}/` },
        { source: '/site-assets/:path+', destination: `${CLUZO_SITE_URL}/site-assets/:path+` },
      ],
    }
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // תשובות ה-API לא נשמרות בשום מטמון ביניים — הן מכילות נתוני לקוח.
      {
        source: '/api/:path*',
        headers: [
          ...securityHeaders,
          { key: 'Cache-Control', value: 'no-store, max-age=0, must-revalidate' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
