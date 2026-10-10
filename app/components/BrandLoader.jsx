/**
 * טוען המותג (Cluzo) — אנימציית המותג במקום הספינר הגנרי.
 *
 * 10.10, ויטלי בחר "גרסה ג · גל": האותיות c-l-u-z-o עולות אחת אחרי השנייה,
 * הסמל מסתובב חצי סיבוב והנקודה שב-o פועמת (public/brand/cluzo/cluzo-loader*.svg).
 * הקבצים הדוממים (-still) הם הלוגו בלי תנועה.
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
 * וה-CSS (‎.brand-loader ב-globals) מחליף ביניהם במדיה קוורי של העמוד עצמו.
 *
 * tone="dark" מחליף לעותק בצבעי רקע כהה (טקסט לבן, כמו cluzo-logo-dark) — לשימוש על
 * --tv-sidebar ועל כל משטח כהה אחר.
 *
 * decorative — כשהאנימציה היא סימן מותג ולא חיווי טעינה (מסך "ברוכים הבאים",
 * שם לא נטען כלום ופשוט עוד לא נבחר פרויקט). אז אין role="status" ואין
 * aria-label: קורא מסך שיכריז "טוען" במסך שלא טוען כלום פשוט משקר.
 */
const RATIO = 280 / 800  // היחס המקורי של הנכס (viewBox 800×280)

export default function BrandLoader({
  label = 'טוען את הדשבורד',
  hint = null,
  width = 280,
  tone = 'light',
  decorative = false,
  className = '',
}) {
  const base = tone === 'dark' ? '/brand/cluzo/cluzo-loader-dark' : '/brand/cluzo/cluzo-loader'
  const h = Math.round(width * RATIO)

  return (
    <div
      className={['brand-loader', className].filter(Boolean).join(' ')}
      style={{ '--brand-loader-w': `${width}px` }}
      {...(decorative ? { 'aria-hidden': 'true' } : { role: 'status', 'aria-label': label })}
    >
      {/* alt ריק בכוונה: ה-aria-label על המעטפת הוא ההכרזה, ותמונה עם alt
          משלה הייתה גורמת לקורא מסך להקריא את המותג פעמיים. */}
      <img className="brand-loader-motion" src={`${base}.svg`} width={width} height={h} alt="" />
      <img className="brand-loader-still" src={`${base}-still.svg`} width={width} height={h} alt="" />
      {hint ? <p className="brand-loader-hint">{hint}</p> : null}
    </div>
  )
}
