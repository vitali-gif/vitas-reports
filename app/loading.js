/**
 * מסך הטעינה של App Router. בלעדיו הדפדפן נשאר על העמוד הקודם (או על לבן)
 * עד שהצ'אנק של הדשבורד יורד — שנייה או שתיים שנראות כמו תקלה.
 */
export default function Loading() {
  return (
    <div dir="rtl" style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg, #F5F7FB)', fontFamily: "'Heebo', system-ui, sans-serif",
    }}>
      <div style={{ textAlign: 'center' }}>
        <div
          aria-hidden="true"
          style={{
            width: 44, height: 44, margin: '0 auto 16px',
            border: '3px solid rgba(91,94,244,0.25)', borderTopColor: 'var(--indigo, #5B5EF4)',
            borderRadius: '50%', animation: 'vitasLoadingSpin 0.8s linear infinite',
          }}
        />
        <p style={{ color: 'var(--text-3, #5E6478)', fontSize: 14, margin: 0 }}>טוען...</p>
        <style>{`
          @keyframes vitasLoadingSpin { to { transform: rotate(360deg); } }
          @media (prefers-reduced-motion: reduce) {
            [style*="vitasLoadingSpin"] { animation-duration: 2.4s !important; }
          }
        `}</style>
      </div>
    </div>
  )
}
