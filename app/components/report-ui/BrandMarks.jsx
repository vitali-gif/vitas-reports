'use client';

import { Phone, Users, Globe, Link2 } from 'lucide-react';

/**
 * סימני מותג לתגיות בטבלאות (Meta, Google, yad2, WhatsApp) — SVG inline, ללא נכסים חיצוניים.
 * SourceMark ממפה שם מקור הגעה מה-CRM לסימן המתאים (כוכבית = לידים מטלפון, מקורבים = אנשים).
 */
export function MetaMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="vr-meta-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0064E0" />
          <stop offset="1" stopColor="#0082FB" />
        </linearGradient>
      </defs>
      <path d="M2.2 12c0-3.4 1.9-6.3 4.6-6.3C10.3 5.7 12 12 12 12s1.7-6.3 5.2-6.3c2.7 0 4.6 2.9 4.6 6.3s-1.9 6.3-4.6 6.3C13.7 18.3 12 12 12 12s-1.7 6.3-5.2 6.3C4.1 18.3 2.2 15.4 2.2 12z"
        fill="none" stroke="url(#vr-meta-grad)" strokeWidth="2.3" strokeLinejoin="round" />
    </svg>
  );
}

export function GoogleMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** yad2 — הבלוב הכתום עם הכיתוב הלבן, מקורב בגודל תגית */
export function Yad2Mark({ size = 16 }) {
  const w = Math.round(size * 2);
  return (
    <svg width={w} height={size} viewBox="0 0 64 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="vr-yad2-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#F26A1B" />
          <stop offset="1" stopColor="#FFB020" />
        </linearGradient>
      </defs>
      <path d="M12 4h40a12 12 0 0 1 0 24H12A12 12 0 0 1 12 4z" fill="url(#vr-yad2-grad)" />
      <text x="32" y="21" textAnchor="middle" fontFamily="Heebo, Arial, sans-serif" fontWeight="800" fontSize="15" fill="#fff">yad2</text>
    </svg>
  );
}

/** WhatsApp — עיגול ירוק עם שפופרת */
export function WhatsAppMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#25D366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2z" />
      <path fill="#fff" d="M8.6 7.3c.2-.4.4-.4.7-.4h.5c.2 0 .4 0 .5.4l.8 1.9c.1.2.1.4 0 .5l-.5.7c-.1.2-.2.3 0 .5.5.9 1.4 1.7 2.4 2.2.2.1.3.1.5-.1l.7-.8c.2-.2.3-.2.5-.1l1.9.9c.3.1.4.2.4.4 0 .4-.1 1.1-.5 1.5-.5.5-1.3.8-1.9.7-1-.1-2.6-.7-3.9-2.1-1.3-1.3-2-2.8-2.1-3.8-.1-.6.2-1.5.5-2z" />
    </svg>
  );
}

/** מיפוי שם מקור הגעה (כפי שנרשם ב-CRM) לסימן. null כשאין סימן מוכר. */
export function SourceMark({ name, size = 16 }) {
  const n = String(name || '').toLowerCase();
  let mark = null;
  if (/facebook|פייסבוק|meta|instagram|אינסטגרם/.test(n)) mark = <MetaMark size={size} />;
  else if (/google|גוגל/.test(n)) mark = <GoogleMark size={size - 2} />;
  else if (/yad2|יד2|יד 2/.test(n)) mark = <Yad2Mark size={size} />;
  else if (/whatsapp|וואטסאפ|ווטסאפ/.test(n)) mark = <WhatsAppMark size={size} />;
  else if (/כוכבית|טלפון|phone/.test(n)) mark = <Phone size={size - 1} aria-hidden="true" />;
  else if (/מקורבים|referral|הפניות|חבר מביא/.test(n)) mark = <Users size={size} aria-hidden="true" />;
  else if (/אתר|site|web|landing|נחיתה/.test(n)) mark = <Globe size={size - 1} aria-hidden="true" />;
  else if (/link|קישור|utm/.test(n)) mark = <Link2 size={size - 1} aria-hidden="true" />;
  if (!mark) return null;
  return <span className="vr-source-mark">{mark}</span>;
}
