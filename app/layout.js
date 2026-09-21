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

export const metadata = {
  title: 'Tovno by Vitas — מערכת דוחות',
  description: 'מערכת דוחות ללקוחות',
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
        <meta name="apple-mobile-web-app-title" content="Tovno" />
        {/* אייקוני Tovno (Tovno-Logo-Kit). קודם לא היה בעמוד שום <link rel="icon">,
            ולכן כל דפדפן ביקש /favicon.ico שלא היה קיים וקיבל 404 בכל טעינה. */}
        <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="any" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

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
