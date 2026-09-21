/**
 * מסך הטעינה של App Router. בלעדיו הדפדפן נשאר על העמוד הקודם (או על לבן)
 * עד שהצ'אנק של הדשבורד יורד — שנייה או שתיים שנראות כמו תקלה.
 *
 * מרגע המיתוג זה הטוען של Tovno. הוא <img> של SVG מונפש, ולכן עובד גם כאן,
 * במסך שרץ לפני שה-JS של הדשבורד בכלל ירד.
 */
import TovnoLoader from './components/TovnoLoader'

export default function Loading() {
  return (
    <div dir="rtl" style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg, #F5F7FB)', fontFamily: "'Heebo', system-ui, sans-serif",
    }}>
      <TovnoLoader hint="טוען את הדשבורד…" />
    </div>
  )
}
