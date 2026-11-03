'use client'
import { FolderOpen, CalendarDays, GitCompareArrows, LayoutGrid, MousePointerClick, Info, FileText } from 'lucide-react'

// מדריך "איך הדשבורד עובד" ללקוח (נפתח בכניסה הראשונה ומכפתור העזרה). הוצא מ-app/client/page.js ב-3.11.
// ויטלי, 3.11: "לעדכן את הטקסט" — מה שיש בדשבורד היום (השוואה, תתי-הטאבים של CRM, כרטיסים
// שנפתחים, "איך נמדד", ייצוא PDF). אייקונים של lucide במקום אימוג'י, כמו בשאר המערכת.
const STEPS = [
    { icon: FolderOpen, title: 'בוחרים פרויקט', desc: 'בסרגל הצד מופיעים הפרויקטים שלך. לחיצה על פרויקט פותחת את הדוח שלו.' },
    { icon: CalendarDays, title: 'בוחרים תקופה', desc: 'בראש המסך: החודש, 7 או 14 ימים אחרונים, או טווח תאריכים משלך. כל טווח נטען מיד.' },
    { icon: GitCompareArrows, title: 'משווים', desc: '"השוואה לאותה תקופה" מראה ליד כל מדד את השינוי מול התקופה הקודמת באותו אורך.' },
    { icon: LayoutGrid, title: 'הטאבים', desc: '"הכל" הוא התמונה המלאה. "CRM" מראה מה קרה ללידים אצל צוות המכירות: מקורות הגעה, זמני תגובה, התנגדויות, יישובים ופגישות. "Facebook" ו-"Google" מראים את הפרסום בכל פלטפורמה.' },
    { icon: MousePointerClick, title: 'לוחצים על מספר', desc: 'לחיצה על כרטיס עם מספר, למשל פגישות או לידים, פותחת את הרשימה שמאחוריו.' },
    { icon: Info, title: '"איך נמדד"', desc: 'מתחת לחלק מהמספרים מוסבר איך הם מחושבים. המספרים מה-CRM מבוססים על מה שתועד במערכת.' },
    { icon: FileText, title: 'ייצוא דוח', desc: '"ייצוא דוח" מפיק PDF של התקופה שעל המסך, לשליחה או להדפסה.' },
]

export default function OnboardingGuide({ onClose }) {
  const dismissOnboarding = onClose
  return (
        <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(11,15,30,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px', fontFamily: 'var(--font, Heebo, sans-serif)',
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, maxWidth: 520, width: '100%',
        direction: 'rtl', textAlign: 'right',
        boxShadow: '0 24px 60px rgba(11,15,30,0.3)',
        maxHeight: '90vh', position: 'relative', display: 'flex', flexDirection: 'column',
      }}>
        {/* סגירה. עד 28.9 היה רק "הבנתי" בתחתית, ובמובייל צריך היה לגלול עד אליו.
            ה-X יושב מחוץ לאזור הגלילה, כך שהוא נשאר במקום גם כשגוללים. */}
        <button
          type="button"
          onClick={dismissOnboarding}
          aria-label="סגור את המדריך"
          style={{
            position: 'absolute', top: 12, left: 12, zIndex: 1,
            width: 36, height: 36, borderRadius: '50%', border: 'none',
            background: 'var(--tv-canvas)', color: 'var(--tv-text-secondary)', cursor: 'pointer',
            fontSize: 22, lineHeight: 1, fontFamily: 'inherit',
          }}
        >×</button>
      <div style={{ padding: '36px clamp(18px, 5vw, 32px) 28px', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src="/brand/cluzo/cluzo-logo-light.svg" alt="Cluzo by Vitas" style={{ height: 42, width: 'auto', marginBottom: 12 }} />
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: 'var(--tv-text)', letterSpacing: '-0.02em' }}>
            ברוכים הבאים לדשבורד
          </h2>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--tv-text-secondary)', lineHeight: 1.6 }}>
            כך מוצאים כל מספר בדקה
          </p>
        </div>

        {/* Steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
          {STEPS.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 14,
              background: 'var(--tv-surface-subtle)', borderRadius: 12, padding: '14px 16px',
              border: '1px solid var(--tv-border)',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: 'var(--tv-brand-soft)', color: 'var(--tv-brand)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20,
              }}><s.icon size={20} aria-hidden="true" /></div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tv-text)', marginBottom: 3 }}>
                  {s.title}
                </div>
                <div style={{ fontSize: 13, color: 'var(--tv-text-secondary)', lineHeight: 1.6 }}>
                  {s.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tip */}
        <div style={{
          background: 'var(--tv-brand-soft)', border: '1px solid var(--tv-brand-line)',
          borderRadius: 10, padding: '11px 14px', marginBottom: 24,
          fontSize: 13, color: 'var(--tv-brand)', lineHeight: 1.6,
        }}>
          <strong>טיפ:</strong> הנתונים מתעדכנים אוטומטית כמה פעמים ביום. אין צורך לרענן.
        </div>

        <p style={{ margin: '0 0 12px', textAlign: 'center', fontSize: 12.5, color: 'var(--tv-text-muted)' }}>
          אפשר לפתוח את המדריך שוב בכל רגע מכפתור העזרה (?) בראש העמוד.
        </p>

        {/* CTA */}
        <button
          onClick={dismissOnboarding}
          style={{
            display: 'block', width: '100%', padding: '13px',
            background: 'var(--tv-brand, #315CF5)', color: '#fff', border: 'none',
            borderRadius: 10, fontSize: 15, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: 'none',
          }}>
          הבנתי, אפשר להתחיל
        </button>

      </div>
      </div>
    </div>
  )
}
