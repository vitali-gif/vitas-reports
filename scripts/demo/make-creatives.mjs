/**
 * scripts/demo/make-creatives.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * מייצר 6 קריאייטיבים סינתטיים ל-public/demo/ — הדמיות אדריכליות מופשטות
 * של פרויקט מגורים. SVG בלבד: קל, חד בכל רזולוציה, ואפס תלות חיצונית.
 *
 * הרצה:  node scripts/demo/make-creatives.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { DEMO } from './dictionaries.mjs'

const OUT = new URL('../../public/demo/', import.meta.url)

const PALETTES = [
  { sky: ['#0EA5E9', '#7DD3FC'], bld: ['#0F172A', '#1E293B', '#334155'], acc: '#F59E0B', ground: '#0B1220', label: 'שקיעה עירונית' },
  { sky: ['#1E1B4B', '#4C1D95'], bld: ['#111827', '#1F2937', '#374151'], acc: '#F472B6', ground: '#0A0A1A', label: 'ערב' },
  { sky: ['#FDE68A', '#FB923C'], bld: ['#1C1917', '#292524', '#44403C'], acc: '#0EA5E9', ground: '#171412', label: 'זריחה' },
  { sky: ['#67E8F9', '#0891B2'], bld: ['#0C4A6E', '#075985', '#0E7490'], acc: '#FDE047', ground: '#082F49', label: 'יום בהיר' },
  { sky: ['#E0E7FF', '#A5B4FC'], bld: ['#312E81', '#3730A3', '#4338CA'], acc: '#FB7185', ground: '#1E1B4B', label: 'בוקר' },
  { sky: ['#111827', '#1F2937'], bld: ['#0EA5E9', '#0284C7', '#0369A1'], acc: '#FDE047', ground: '#030712', label: 'לילה' },
]

/** מגדל בודד עם רשת חלונות. */
function tower(x, w, h, baseY, fill, accent, seedOffset) {
  const floors = Math.max(4, Math.floor(h / 26))
  const cols   = Math.max(2, Math.floor(w / 22))
  let windows = ''
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      // דפוס דטרמיניסטי — אותה תמונה בכל הרצה
      const lit = ((f * 7 + c * 13 + seedOffset) % 5) < 2
      const wx = x + 10 + c * ((w - 20) / cols)
      const wy = baseY - h + 16 + f * ((h - 26) / floors)
      const ww = Math.max(5, (w - 20) / cols - 6)
      const wh = Math.max(6, (h - 26) / floors - 7)
      windows += `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="${ww.toFixed(1)}" height="${wh.toFixed(1)}" rx="1" fill="${lit ? accent : '#FFFFFF'}" opacity="${lit ? 0.85 : 0.13}"/>`
    }
  }
  return `<rect x="${x}" y="${baseY - h}" width="${w}" height="${h}" rx="3" fill="${fill}"/>${windows}`
}

/**
 * היפוך ידני של מחרוזת עברית + unicode-bidi="bidi-override".
 * SVG מרונדר גם ע"י מנועים שאינם דפדפן (תצוגה מקדימה, ייצוא, בוטים) ולא כולם
 * מיישמים את אלגוריתם ה-bidi. ההיפוך המפורש מבטיח תצוגה נכונה בכל מנוע.
 */
const rtl = (s) => [...s].reverse().join('')

function creative(i, p) {
  // 1080×1080 — היחס הסטנדרטי של קריאייטיב פיד ב-Meta. פורמט רחב היה
  // מתקבל בכרטיסי "המודעות המובילות" עם פסים שחורים למעלה ולמטה.
  const W = 1080, H = 1080, GY = 830
  // קו רקיע שונה לכל קריאייטיב — כדי שהתמונות יהיו נבדלות כתמונות ממוזערות
  const LAYOUTS = [
    [[ 60,150,330],[230,185,470],[440,165,390],[630,200,530],[855,150,300]],
    [[ 45,175,505],[245,140,310],[410,195,430],[630,155,360],[810,190,480]],
    [[ 70,200,375],[295,150,510],[470,175,325],[670,190,455],[885,140,275]],
    [[ 40,145,435],[210,185,345],[420,160,520],[605,205,390],[835,170,325]],
    [[ 60,190,300],[275,165,475],[465,200,405],[690,140,500],[855,165,355]],
    [[ 50,160,475],[235,200,385],[460,145,440],[630,180,315],[835,195,500]],
  ]
  const towers = LAYOUTS[i % LAYOUTS.length].map(([x, w, h]) => ({ x, w, h }))
  const bodies = towers
    .map((t, k) => tower(t.x, t.w, t.h, GY, p.bld[k % p.bld.length], p.acc, i * 3 + k))
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="הדמיה — ${DEMO.projectName}">
  <defs>
    <linearGradient id="sky${i}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.sky[0]}"/>
      <stop offset="100%" stop-color="${p.sky[1]}"/>
    </linearGradient>
    <linearGradient id="fade${i}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.ground}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${p.ground}" stop-opacity="0.9"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#sky${i})"/>
  <circle cx="${150 + i * 130}" cy="${160 + (i % 3) * 40}" r="${58 - i * 4}" fill="${p.acc}" opacity="0.28"/>

  ${bodies}

  <rect x="0" y="${GY}" width="${W}" height="${H - GY}" fill="${p.ground}"/>
  <rect x="0" y="${GY - 120}" width="${W}" height="${H - GY + 120}" fill="url(#fade${i})"/>

  <!-- עצים / נוף -->
  ${[60, 190, 380, 560, 740, 900, 1020].map((tx, k) =>
    `<ellipse cx="${tx}" cy="${GY + 26 + (k % 3) * 10}" rx="${28 + (k % 4) * 6}" ry="${14 + (k % 3) * 4}" fill="${p.acc}" opacity="0.16"/>`
  ).join('')}

  <!-- כיתוב -->
  <text x="60" y="${H - 82}" direction="rtl" unicode-bidi="bidi-override" font-family="Heebo, Arial, sans-serif" font-size="42" font-weight="800" fill="#FFFFFF" opacity="0.96">${rtl(DEMO.projectName)}</text>
  <text x="60" y="${H - 44}" direction="rtl" unicode-bidi="bidi-override" font-family="Heebo, Arial, sans-serif" font-size="19" font-weight="500" fill="#FFFFFF" opacity="0.62">${rtl('הדמיה להמחשה בלבד · ' + p.label)}</text>
  <text x="${W - 60}" y="${H - 44}" text-anchor="end" font-family="Heebo, Arial, sans-serif" font-size="15" font-weight="700" fill="${p.acc}" opacity="0.85" letter-spacing="2">DEMO</text>
</svg>
`
}

mkdirSync(OUT, { recursive: true })
PALETTES.forEach((p, i) => {
  const name = `creative-${String(i + 1).padStart(2, '0')}.svg`
  writeFileSync(new URL(name, OUT), creative(i, p), 'utf8')
  console.log('✓ public/demo/' + name)
})
console.log(`\n${PALETTES.length} קריאייטיבים נוצרו.`)
