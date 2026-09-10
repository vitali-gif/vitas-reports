/** @type {import('next').NextConfig} */

// כותרות אבטחה. עד עכשיו התשובות נשאו רק HSTS (מ-Vercel), כך שאפשר היה
// להטמיע את הדשבורד ב-iframe באתר זר.
//
// CSP מלא לא נכלל כאן בכוונה: הדף טוען Google Fonts, Microsoft Clarity ו-Supabase,
// ומדיניות שגויה שוברת אותם בשקט. התבנית למטה היא נקודת ההתחלה — להפעיל אותה
// קודם כ-Content-Security-Policy-Report-Only ולבדוק את הקונסול לפני שאוכפים.
//
//   default-src 'self';
//   script-src 'self' 'unsafe-inline' https://www.clarity.ms;
//   style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
//   font-src 'self' https://fonts.gstatic.com;
//   img-src 'self' data: blob: https:;
//   connect-src 'self' https://*.supabase.co https://*.clarity.ms;
//   frame-ancestors 'none';
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
]

const nextConfig = {
  reactStrictMode: true,
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
