/**
 * טוען Tovno — אנימציית המותג במקום הספינר הגנרי.
 *
 * ה-SVG מנפיש את עצמו: יש בתוכו <style> עם @keyframes, בלי ספריות, בלי גופנים
 * חיצוניים ובלי JS. לכן הוא נטען כ-<img> ולא מוזרק inline — כך ה-@keyframes שלו
 * לא דולפים לעמוד, וגם לא נוספות 14 צורות ל-DOM בכל מסך טעינה.
 *
 * הלולאה 2.6 שניות, אבל אסור להמתין לה: מסתירים את הטוען ברגע שהנתונים והממשק
 * מוכנים — בדיוק כמו הספינר שהיה כאן קודם.
 *
 * תנועה מופחתת: לקובץ ה-SVG יש כלל prefers-reduced-motion משלו, אבל הוא לא
 * נכנס לתוקף כשהוא נטען כ-<img> — נמדד ב-Chromium: ההגדרה של המשתמש לא מגיעה
 * להקשר של התמונה והאנימציה המשיכה לרוץ. לכן יש כאן שני קבצים, מונפש ודומם,
 * וה-CSS (‎.tovno-loader ב-globals) מחליף ביניהם במדיה קוורי של העמוד עצמו.
 *
 * tone="dark" מחליף לעותק בצבעי רקע כהה (#EDF2FF / #7191FF) — לשימוש על
 * --tv-sidebar ועל כל משטח כהה אחר.
 */
const RATIO = 94 / 280  // היחס המקורי של הנכס (955×320)

export default function TovnoLoader({
  label = 'טוען את הדשבורד',
  hint = null,
  width = 280,
  tone = 'light',
  className = '',
}) {
  const base = tone === 'dark' ? '/brand/tovno/tovno-loader-dark' : '/brand/tovno/tovno-loader'
  const h = Math.round(width * RATIO)

  return (
    <div
      className={['tovno-loader', className].filter(Boolean).join(' ')}
      style={{ '--tovno-loader-w': `${width}px` }}
      role="status"
      aria-label={label}
    >
      {/* alt ריק בכוונה: ה-aria-label על המעטפת הוא ההכרזה, ותמונה עם alt
          משלה הייתה גורמת לקורא מסך להקריא את המותג פעמיים. */}
      <img className="tovno-loader-motion" src={`${base}.svg`} width={width} height={h} alt="" />
      <img className="tovno-loader-still" src={`${base}-still.svg`} width={width} height={h} alt="" />
      {hint ? <p className="tovno-loader-hint">{hint}</p> : null}
    </div>
  )
}
