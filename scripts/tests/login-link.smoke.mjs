// בדיקת עשן: קישור הכניסה החד-פעמי יוצא על הדומיין שלנו ולא על זה של Supabase (lib/login-link.js).
import assert from 'node:assert/strict'
import { siteLoginLink } from '../../lib/login-link.js'

const site = 'https://reports.vitas.co.il'

// 1. יש hashed_token — קישור שלנו, עם setpw=1 ו-th מקודד
const link = siteLoginLink({ properties: { hashed_token: 'ab+c/d=', action_link: 'https://x.supabase.co/auth/v1/verify?token=1' } }, site)
assert.equal(link, 'https://reports.vitas.co.il/client?setpw=1&th=ab%2Bc%2Fd%3D')
assert.ok(!link.includes('supabase.co'))
assert.equal(new URL(link).searchParams.get('th'), 'ab+c/d=')

// 2. אין hashed_token — נופלים ל-action_link (עדיף קישור עובד מכלום)
assert.equal(siteLoginLink({ properties: { action_link: 'https://x.supabase.co/v' } }, site), 'https://x.supabase.co/v')

// 3. אין כלום — null, וה-route מחזיר שגיאה
assert.equal(siteLoginLink(null, site), null)
assert.equal(siteLoginLink({ properties: {} }, site), null)

console.log('login-link: OK')
