import './globals.css';

export const metadata = {
  title: 'VITAS Reports - \u05DE\u05E2\u05E8\u05DB\u05EA \u05D3\u05D5\u05D7\u05D5\u05EA',
  description: '\u05DE\u05E2\u05E8\u05DB\u05EA \u05D3\u05D5\u05D7\u05D5\u05EA \u05DC\u05DC\u05E7\u05D5\u05D7\u05D5\u05EA',
};

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
