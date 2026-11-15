import './globals.css';
// העיצוב המחודש (ענף redesign): פעיל רק בתוך .vr-ui — פיילוט נדל"ן, טאב "הכל". ראה design/handoff-v1.
import './components/report-ui/vitas-visual.css';
import './components/report-ui/vitas-bridge.css';
import './components/report-ui/crm-sources.css';
import './components/report-ui/response-times.css';
import './components/report-ui/facebook.css';
import './components/report-ui/kloss.css';
import './components/report-ui/erika.css';
import './components/report-ui/ads-sections.css';
import './components/meetings/meetings.css';
import './components/auth/signin.css';
// שדרוג העיצוב (29.10) — נטען אחרון כדי לגבור על השכבות הקודמות. ראו את ראש הקובץ.
import './components/report-ui/cluzo-polish.css';

// תצוגת הקישור בוואטסאפ / מייל / סלאק (ויטלי, 15.11): בלי og:image וואטסאפ לקח את אייקון האפליקציה
// והציג ריבוע קטן. תמונה רחבה 1200×630 (public/og-image.png) מוצגת כתצוגה גדולה.
// עמוד הבית (/) מגיע מ-cluzo-site עם תגיות משלו; כאן זה חל על /client, /admin ושאר העמודים.
const OG_TITLE = 'Cluzo by Vitas - הדשבורד שלך'
const OG_DESC = 'לידים, פגישות, עסקאות ופרסום במקום אחד. מתעדכן כל שעה.'
export const metadata = {
  metadataBase: new URL('https://reports.vitas.co.il'),
  title: 'Cluzo by Vitas - מערכת דוחות',
  description: OG_DESC,
  openGraph: {
    title: OG_TITLE, description: OG_DESC, siteName: 'Cluzo by Vitas', locale: 'he_IL', type: 'website',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Cluzo by Vitas - הדשבורד של הלקוחות של VITAS' }],
  },
  twitter: { card: 'summary_large_image', title: OG_TITLE, description: OG_DESC, images: ['/og-image.png'] },
};

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
        {/* PWA */}
        <meta name="theme-color" content="#14243C" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Cluzo" />
        {/* אייקוני Cluzo (חבילת המותג Cluzo-Brand-Kit, 10.10). קודם לא היה בעמוד שום <link rel="icon">,
            ולכן כל דפדפן ביקש /favicon.ico שלא היה קיים וקיבל 404 בכל טעינה. */}
        <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="any" />
        <link rel="apple-touch-icon" href="/apple-touch-icon-v2.png" />

        {/*
          Microsoft Clarity הוסר מהפרויקט לגמרי (לא בשימוש). הוא ישב כאן ורץ על
          כל עמוד — כולל דשבורד הלקוח — כלומר הקליט מסכים שמוצגים בהם שמות
          וטלפונים של לידים ושלח אותם לצד שלישי, בלי הסכמה ובלי מדיניות פרטיות.
          אם יוחזר יום אחד: רק על עמוד הנחיתה השיווקי, לעולם לא על /client.
        */}
      </head>
      <body>{children}</body>
    </html>
  );
}
