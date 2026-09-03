'use client'
/**
 * גבול שגיאות. בלי הקובץ הזה שגיאה לא מטופלת בדשבורד מציגה ללקוח מסך לבן ריק,
 * בלי הסבר ובלי דרך לצאת — והשיחה מגיעה אליך בטלפון.
 */
import { useEffect } from 'react'

export default function Error({ error, reset }) {
  useEffect(() => { console.error(error) }, [error])

  return (
    <div dir="rtl" style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg, #F5F7FB)', fontFamily: "'Heebo', system-ui, sans-serif", padding: 24,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ fontSize: 44, marginBottom: 14 }}>⚠️</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800, color: 'var(--text, #0B0F1E)' }}>
          משהו השתבש בטעינת הדוח
        </h2>
        <p style={{ margin: '0 0 24px', fontSize: 14, lineHeight: 1.6, color: 'var(--text-3, #5E6478)' }}>
          זו תקלה זמנית ולא בעיה בנתונים שלך. נסה לטעון מחדש — ואם זה חוזר, כתוב לנו.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => reset()} style={{
            padding: '11px 24px', background: 'var(--indigo, #5B5EF4)', color: '#fff', border: 'none',
            borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            נסה שוב
          </button>
          <a href="mailto:vitali@vitas.co.il?subject=תקלה בדוח" style={{
            padding: '11px 24px', background: 'transparent', color: 'var(--indigo, #5B5EF4)',
            border: '1px solid var(--indigo, #5B5EF4)', borderRadius: 10, fontSize: 14, fontWeight: 700,
            textDecoration: 'none', fontFamily: 'inherit',
          }}>
            כתוב לנו
          </a>
        </div>
        {error?.digest && (
          <p style={{ marginTop: 20, fontSize: 11, color: 'var(--text-3, #98A0B2)', direction: 'ltr' }}>
            ref: {error.digest}
          </p>
        )}
      </div>
    </div>
  )
}
