/**
 * scripts/demo/build-demo-dataset.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * מרכיב את הדאטהסט הקפוא וכותב אותו ל-lib/demo-dataset.js.
 *
 * הרצה:  node scripts/demo/build-demo-dataset.mjs
 *
 * הפלט הוא קובץ אחד שנכנס ל-git ומהווה את **מקור האמת היחיד** של הדמו.
 * אין בו שום נתון אמיתי — הוא נבנה כולו מ-profile.mjs + dictionaries.mjs.
 */

import { writeFileSync } from 'node:fs'
import { PROFILE } from './profile.mjs'
import { synthesize } from './synthesize.mjs'

const OUT = new URL('../../lib/demo-dataset.js', import.meta.url)

const dataset = synthesize(PROFILE)

const header = `/**
 * lib/demo-dataset.js — נוצר אוטומטית. אין לערוך ידנית.
 * ─────────────────────────────────────────────────────────────────────────────
 * הדאטהסט הקפוא של פרויקט הדמו "${dataset.meta.project}" (${dataset.meta.client}).
 *
 * נוצר ע"י: node scripts/demo/build-demo-dataset.mjs
 * פרופיל:   scripts/demo/profile.mjs  (_source: ${PROFILE._source})
 * סכימת CRM: v${dataset.meta.crmSchemaVersion}
 *
 * הנתונים כאן **קבועים לנצח** — אותם מספרים בדיוק בכל צפייה. רק התאריכים
 * מוזזים בזמן ה-seed כדי שהתקופות יתאימו למפתחות שהדשבורד מחשב מהיום הנוכחי
 * (ראה §5 במסמך האפיון: אפיון_פרויקט_דמו.md).
 *
 * לשינוי המספרים: ערוך את scripts/demo/profile.mjs והרץ מחדש את הבילד.
 */

`

const body = `export const DEMO_DATASET = ${JSON.stringify(dataset, null, 1)}\n\nexport default DEMO_DATASET\n`

writeFileSync(OUT, header + body, 'utf8')

const bytes = Buffer.byteLength(header + body, 'utf8')
console.log(`✓ lib/demo-dataset.js  (${(bytes / 1024).toFixed(0)} KB)`)
console.log(`  לקוח:   ${dataset.meta.client}`)
console.log(`  פרויקט: ${dataset.meta.project}`)
console.log(`  תקופות: ${Object.values(dataset.meta.periodKeys).join(' · ')}`)
console.log(`  רשומות: ${dataset.reports.length}`)
console.log(`\n  הרץ עכשיו:  node scripts/demo/verify-dataset.mjs`)
