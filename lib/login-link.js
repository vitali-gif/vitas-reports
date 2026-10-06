// קישור כניסה חד-פעמי על הדומיין שלנו.
//
// action_link של Supabase נראה כך: https://hemxbbiuwtpuxunxmukd.supabase.co/auth/v1/verify?token=…
// — לקוח שמקבל אותו במייל או בוואטסאפ רואה דומיין זר ולא מוכר, וזה נראה כמו פישינג (ויטלי, 6.10).
// במקום זה שולחים https://reports.vitas.co.il/client?th=<hashed_token>, ודף הכניסה מאמת את הקוד בעצמו
// עם supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }) (app/client/page.js).
// יתרון נוסף: סורקי קישורים במייל (Outlook Safe Links) שפותחים את הקישור מראש כבר לא "שורפים" אותו —
// הקוד נצרך רק כשהדף רץ בדפדפן.

/**
 * @param {object} linkData  התשובה של supabaseAdmin.auth.admin.generateLink (data)
 * @param {string} siteUrl   https://reports.vitas.co.il
 * @returns {string|null}    הקישור לשליחה; action_link של Supabase אם אין hashed_token
 */
export function siteLoginLink(linkData, siteUrl) {
  const props = linkData?.properties
  const th = props?.hashed_token
  if (!th) return props?.action_link || null
  return `${siteUrl}/client?setpw=1&th=${encodeURIComponent(th)}`
}
