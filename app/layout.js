import './globals.css';

export const metadata = {
  title: 'VITAS Reports - מערכת דוחות',
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
        <meta name="theme-color" content="#0B0F1E" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="VITAS Reports" />
        <link rel="apple-touch-icon" href="/brand/icon-192.png" />

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
