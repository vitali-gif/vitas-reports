/**
 * 404. ברירת המחדל של Next היא עמוד לבן באנגלית — לא מה שלקוח אמור לראות
 * כשהוא לוחץ על קישור ישן למערכת בעברית.
 */
import Link from 'next/link'

export default function NotFound() {
  return (
    <div dir="rtl" style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg, #F5F7FB)', fontFamily: "'Heebo', system-ui, sans-serif", padding: 24,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ fontSize: 44, marginBottom: 14 }} aria-hidden="true">🧭</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800, color: 'var(--text, #0B0F1E)' }}>
          העמוד הזה לא קיים
        </h2>
        <p style={{ margin: '0 0 24px', fontSize: 14, lineHeight: 1.6, color: 'var(--text-3, #5E6478)' }}>
          ייתכן שהקישור ישן או שהוקלד לא נכון.
        </p>
        <Link
          href="/client"
          style={{
            display: 'inline-block', padding: '11px 24px', background: 'var(--indigo, #5B5EF4)',
            color: '#fff', borderRadius: 10, fontSize: 14, fontWeight: 700, textDecoration: 'none',
          }}
        >
          חזרה לדוח
        </Link>
      </div>
    </div>
  )
}
