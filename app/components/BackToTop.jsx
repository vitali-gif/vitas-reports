'use client';

import { useState, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';

/**
 * כפתור "חזרה לראש העמוד" (ויטלי, 20.9).
 *
 * הדשבורד ארוך — טבלת קמפיינים, גלריות קריאייטיב, פילוחים — והדרך היחידה לחזור
 * לבורר התקופה שבראש הייתה גלילה ידנית. הכפתור צף בפינה ומופיע רק אחרי שיש לאן
 * לחזור.
 *
 * למה prefers-reduced-motion: גלילה חלקה על עמוד ארוך היא בדיוק סוג התנועה
 * שגורמת לסחרחורת למי שהגדיר במערכת ההפעלה שהוא לא רוצה אנימציות. שם הקפיצה
 * מיידית, והתוצאה זהה.
 */
export default function BackToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // passive: המאזין לא קורא ל-preventDefault, וכך הדפדפן לא צריך להמתין לו לפני
    // שהוא מצייר את הגלילה.
    const onScroll = () => setShow(window.scrollY > 400);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!show) return null;

  const toTop = () => {
    const reduce = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <button type="button" className="back-to-top" onClick={toTop} title="חזרה לראש העמוד" aria-label="חזרה לראש העמוד">
      <ArrowUp size={20} aria-hidden="true" />
    </button>
  );
}
