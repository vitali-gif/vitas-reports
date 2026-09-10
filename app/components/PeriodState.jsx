'use client'
/**
 * מצבי תקופה — מה מוצג כשאין נתונים לתקופה שנבחרה.
 *
 * הרקע: הדשבורד צייר אפסים בכל המדדים בשני מצבים שונים לגמרי — "נמשכים כרגע
 * נתונים" ו"אין נתונים לתקופה הזו" — ושניהם נראו זהים ללקוח, כמו דוח שבור.
 * שני המסכים כאן מפרידים ביניהם ואומרים במפורש מה קורה.
 */
import React from 'react'
import SkeletonDashboard from '../../lib/skeleton'

const wrap = {
  textAlign: 'center', padding: '28px 24px 20px', direction: 'rtl',
  fontFamily: 'var(--font, Heebo, system-ui, sans-serif)',
}

/** נמשכים נתונים חיים לתקופה שאינה במטמון. */
export function PeriodFetching() {
  return (
    <div>
      <div style={wrap} role="status" aria-live="polite">
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 12,
          background: 'rgba(91,94,244,0.08)', border: '1px solid rgba(91,94,244,0.22)',
          borderRadius: 12, padding: '12px 20px', maxWidth: '100%',
        }}>
          <span className="period-state-spinner" aria-hidden="true" />
          <span style={{ textAlign: 'right' }}>
            <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--text, #0B0F1E)' }}>
              מושכים נתונים לתקופה הזו
            </span>
            <span style={{ display: 'block', fontSize: 13, color: 'var(--text-3, #5E6478)', marginTop: 2 }}>
              התקופה הזו נבדקת בפעם הראשונה, אז זה לוקח כחצי דקה. אפשר להישאר בעמוד.
            </span>
          </span>
        </div>
      </div>
      <SkeletonDashboard />
      <style jsx>{`
        .period-state-spinner {
          width: 22px; height: 22px; flex-shrink: 0;
          border: 3px solid rgba(91, 94, 244, 0.25);
          border-top-color: var(--indigo, #5B5EF4);
          border-radius: 50%;
          animation: periodSpin 0.8s linear infinite;
        }
        @keyframes periodSpin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .period-state-spinner { animation-duration: 2.4s; }
        }
      `}</style>
    </div>
  )
}

/**
 * "עודכן לאחרונה" — הקרונים רצים כל שעתיים ועד עכשיו לא היה שום חיווי מתי
 * הנתונים נכתבו. זו השאלה הראשונה של כל לקוח שמסתכל על דוח, והיחידה שהאונבורדינג
 * הבטיח לענות עליה ("הנתונים מתעדכנים אוטומטית") בלי להראות שום הוכחה.
 */
export function LastUpdated({ reports, selectedMonth }) {
  const rows = (reports || []).filter(r => r.month === selectedMonth && r.created_at)
  if (!rows.length) return null

  const latest = rows.reduce((max, r) => (r.created_at > max ? r.created_at : max), rows[0].created_at)
  const then = new Date(latest)
  if (Number.isNaN(then.getTime())) return null

  const minutes = Math.max(0, Math.round((Date.now() - then.getTime()) / 60000))
  const relative =
    minutes < 2    ? 'ממש עכשיו'
    : minutes < 60 ? `לפני ${minutes} דקות`
    : minutes < 120 ? 'לפני שעה'
    : minutes < 1440 ? `לפני ${Math.round(minutes / 60)} שעות`
    : minutes < 2880 ? 'אתמול'
    : `לפני ${Math.round(minutes / 1440)} ימים`

  const exact = then.toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })

  // מעל שש שעות זה כבר חריג — הקרון אמור לרוץ כל שעתיים.
  const stale = minutes > 360

  return (
    <div
      title={`עודכן ב-${exact}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, direction: 'rtl',
        fontSize: 12.5, color: stale ? 'var(--warning, #9C5C12)' : 'var(--text-3, #98A0B2)',
        padding: '6px 2px 0', fontFamily: 'var(--font, Heebo, sans-serif)',
      }}
    >
      <span aria-hidden="true" style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        background: stale ? 'var(--warning, #9C5C12)' : 'var(--success, #2E7D5B)',
      }} />
      <span>עודכן {relative}</span>
      <span style={{ opacity: 0.6 }}>·</span>
      <span style={{ opacity: 0.8, direction: 'ltr', unicodeBidi: 'isolate' }}>{exact}</span>
    </div>
  )
}

/** נבדק, ובאמת אין נתונים לתקופה הזו. */
export function PeriodEmpty({ onRefresh }) {
  return (
    <div className="welcome-center" style={{ direction: 'rtl' }}>
      <div className="icon" aria-hidden="true">📅</div>
      <h3>אין נתונים לתקופה שנבחרה</h3>
      <p style={{ marginTop: 10, color: 'var(--text-secondary, #5E6478)', lineHeight: 1.6, maxWidth: 380 }}>
        לא נרשמה פעילות בטווח התאריכים הזה. אפשר לבחור תקופה אחרת מהבורר שלמעלה.
      </p>
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="btn btn-primary"
          style={{ marginTop: 16 }}
        >
          נסה למשוך שוב
        </button>
      )}
    </div>
  )
}
