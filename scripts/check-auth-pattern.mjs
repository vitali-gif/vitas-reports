#!/usr/bin/env node
/**
 * scripts/check-auth-pattern.mjs — שומר סף מול חזרה של תבנית ההרשאה הישנה.
 *
 * הרקע: עד ספטמבר 2026 כל route "מוגן" בדק
 *   x-client-key === NEXT_PUBLIC_SUPABASE_ANON_KEY
 * מפתח ה-anon מוטמע בבאנדל בזמן build (זו המשמעות של התחילית NEXT_PUBLIC_),
 * ולכן זו לא הייתה הרשאה. אחרי שהתבנית הוחלפה ב-lib/auth.js, ה-route
 * bmby/lead-notes נוסף עם התבנית הישנה — פשוט כי היא הייתה הסטנדרט בקוד.
 * הבדיקה הזאת קיימת כדי שזה לא יקרה שוב בשקט.
 *
 * הרצה:  npm run check:auth
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const API_DIR = join(ROOT, 'app', 'api')

// routes שמותר להם להישאר כמו שהם, עם הסבר.
const ALLOWED = new Map([
  ['app/api/bmby/debug/route.js', 'מוגן ב-CRON_SECRET; המפתח מוזכר בהערה בלבד'],
  ['app/api/bmby/debug-response/route.js', 'מוגן ב-CRON_SECRET; המפתח מוזכר בהערה בלבד'],
])

// route ללא אף שומר — מותר רק אם הוא באמת ציבורי.
const PUBLIC_ROUTES = new Set([
  'app/api/keepalive/route.js',
  'app/api/auth/confirm/route.js',
  'app/api/google/script-ingest/route.js',   // שומר משלו: x-script-secret
  // ציבורי בכוונה — כל אחד רשאי לבקש קישור כניסה. ה-route מוודא שהמייל קיים
  // ב-client_access לפני ששולח משהו, ומוגן בהגבלת קצב (lib/rate-limit.js).
  'app/api/client-auth/route.js',
])

const GUARDS = /requireAdmin\s*\(|requireProjectAccess\s*\(|requireUser\s*\(|isInternalCall\s*\(|CRON_SECRET|api_tokens/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name === 'route.js') out.push(p)
  }
  return out
}

const problems = []

for (const file of walk(API_DIR)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  const src = readFileSync(file, 'utf8')
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

  if (/x-client-key/.test(code) && !ALLOWED.has(rel)) {
    problems.push({
      rel,
      msg: 'משתמש ב-x-client-key. מפתח ה-anon ציבורי ולכן זו לא הרשאה — ' +
           'להשתמש ב-requireAdmin / requireProjectAccess מ-lib/auth.js',
    })
    continue
  }

  if (!GUARDS.test(code) && !PUBLIC_ROUTES.has(rel)) {
    problems.push({ rel, msg: 'אין שום בדיקת הרשאה. אם ה-route באמת ציבורי, להוסיף אותו ל-PUBLIC_ROUTES כאן.' })
  }
}

if (problems.length === 0) {
  console.log('✓ כל ה-routes משתמשים בשכבת ההרשאות של lib/auth.js')
  process.exit(0)
}

console.error(`✗ נמצאו ${problems.length} routes בעייתיים:\n`)
for (const p of problems) console.error(`  ${p.rel}\n    ${p.msg}\n`)
process.exit(1)
