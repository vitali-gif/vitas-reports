/**
 * app/components/ProGate.jsx — שילוט ומסך שדרוג לפיצ'רים של מנוי PRO.
 *
 * ⚠️ שני הרכיבים כאן הם **תצוגה בלבד**. הם לא מונעים כלום: מי שיודע לנחש כתובת
 * יכול לפנות ל-/api/meetings ישירות ולעקוף כל דבר שקורה בדפדפן. האכיפה האמיתית
 * יושבת ב-lib/auth.js (requireProjectPlan) ובכל route של הפיצ'ר. CLAUDE.md אוסר
 * במפורש להסתמך על הסתרה בממשק כהרשאה, ולכן ה-ProLock אינו מחליף את השער בשרת
 * אלא מסביר ללקוח מה הוא רואה במקום שגיאת 403 יבשה.
 *
 * ProBadge — תגית "PRO" על הכפתור עצמו, כדי שיהיה ברור מה נמכר בנפרד.
 *            היא מוצגת גם ללקוח שכבר משודרג: זה שילוט של הפיצ'ר, לא של המצב.
 * ProLock  — מה שמוצג במקום תוכן הטאב ללקוח שאינו PRO.
 */
import React from 'react'

export function ProBadge({ className = '' }) {
  return (
    <span className={['pro-badge', className].filter(Boolean).join(' ')} aria-label="פיצ'ר PRO">PRO</span>
  )
}

/**
 * @param {string}   title     שם הפיצ'ר, כפי שהוא כתוב על הכפתור.
 * @param {string}   lead      משפט אחד על מה הפיצ'ר עושה.
 * @param {string[]} bullets   מה נכלל בו. בלי הבטחות שאין להן כיסוי בקוד.
 * @param {string}   contact   כתובת לפנייה לשדרוג.
 */
export function ProLock({
  title,
  lead,
  bullets = [],
  contact = 'vitali@vitas.co.il',
}) {
  const subject = encodeURIComponent(`שדרוג ל-PRO — ${title}`)
  return (
    <div className="pro-lock" role="region" aria-label={`${title} — פיצ'ר PRO`}>
      <div className="pro-lock-card">
        <span className="pro-lock-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
          </svg>
        </span>

        <h2>{title} <ProBadge /></h2>
        <p className="pro-lock-lead">{lead}</p>

        {bullets.length > 0 && (
          <ul className="pro-lock-list">
            {bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        )}

        <a className="pro-lock-cta" href={`mailto:${contact}?subject=${subject}`}>
          לשדרוג — דברו איתנו
        </a>
        <p className="pro-lock-note">
          הפיצ'ר פתוח למנויי PRO. הדוחות, ה-CRM והקמפיינים שלכם ממשיכים לעבוד כרגיל.
        </p>
      </div>
    </div>
  )
}

/**
 * מסך השדרוג של "ישיבות שיווק". יושב כאן ולא באחד משני מוקדי השימוש כי שניהם
 * מציגים אותו: app/admin/page.js חוסם מראש לפי clients.plan שבדפדפן, ו-MeetingsTab
 * מציג אותו כשהשרת החזיר PLAN_REQUIRED על נתון ישן. שני נוסחים לאותו מסך היו נפרדים
 * בעריכה הראשונה.
 *
 * הרשימה מתארת רק מה שקיים בקוד היום (שלב 1): אין כאן יומנים, אין Meet/Teams ואין
 * סיכום AI — ACCEPTANCE.md אוסר למכור יכולת שלא נבדקה.
 */
export function MeetingsProLock() {
  return (
    <ProLock
      title="ישיבות שיווק"
      lead="ניהול ישיבות השיווק והמכירות מול VITAS — במקום אחד, עם מעקב אחרי מה שסוכם."
      bullets={[
        'סיכום של כל ישיבה: נקודות מרכזיות, החלטות ושאלות פתוחות',
        'המשימות שיצאו מהישיבה, עם אחראי ותאריך יעד',
        'מועד בדיקה לכל משימה — מה עולה שוב בישיבה הבאה',
        'שליחת הסיכום במייל למי שצריך לראות אותו',
      ]}
    />
  )
}

export default ProLock
