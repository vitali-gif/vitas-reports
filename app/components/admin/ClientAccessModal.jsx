'use client'
/**
 * ניהול גישת לקוחות + פרטי גישה (1.11, ויטלי: "במובייל לא רואים לאילו פרויקטים יש לחשבון גישה").
 *
 * קודם: טבלה של מייל | לקוח | פרויקטים | מחיקה — בטלפון עמודת הפרויקטים נחתכה, וכל שורה הייתה
 * מייל+לקוח, כך שחשבון אחד עם 4 לקוחות נראה כ-4 שורות בלי לראות את הפרויקטים.
 * עכשיו: כרטיס לכל מייל, ובו הלקוחות והפרויקטים שלו כתגיות (הסרה ב-×, הוספה בתגית מקווקוות).
 * חיפוש לפי מייל, ובראש החלון טופס ההוספה. העיצוב לפי Cluzo Design System (cluzo-polish.css §20).
 *
 * הלוגיקה (שמירה, מחיקה, הוספה) נשארת ב-admin/page.js — כאן רק התצוגה.
 */
import { useMemo, useState } from 'react'
import { Users, X, Trash2, Plus, Check, Search, KeyRound, Copy, MessageCircle, Link2, Crown } from 'lucide-react'

export function ClientAccessModal({
  clients, accessList, email, onEmailChange, projectIds, setProjectIds, onToggleProject,
  emailExists, resendPassword, setResendPassword, saving, onSave,
  onDeleteClient, onRemoveRow, onGrantProject, onSetPlan, loginUrl, onClose,
}) {
  const [q, setQ] = useState('')
  const groups = clients.filter(cl => (cl.projects || []).length)
  const allIds = groups.flatMap(cl => cl.projects.map(p => p.id))
  const allOn = allIds.length > 0 && allIds.every(id => projectIds.includes(id))

  // מייל ← לקוח ← שורות גישה
  const accounts = useMemo(() => {
    const byEmail = new Map()
    for (const ca of accessList) {
      const cid = ca.projects?.client_id || 'unknown'
      if (!byEmail.has(ca.email)) byEmail.set(ca.email, new Map())
      const m = byEmail.get(ca.email)
      if (!m.has(cid)) m.set(cid, { clientId: cid, clientName: ca.projects?.clients?.name || '-', rows: [] })
      m.get(cid).rows.push(ca)
    }
    return [...byEmail.entries()].map(([em, m]) => ({ email: em, clients: [...m.values()], total: [...m.values()].reduce((a, c) => a + c.rows.length, 0) }))
  }, [accessList])
  const shown = q.trim() ? accounts.filter(a => a.email.includes(q.trim().toLowerCase())) : accounts

  return (
    <div className="modal-overlay active" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal cza-sheet" role="dialog" aria-modal="true" aria-labelledby="cza-title" dir="rtl">
        <header className="cza-head">
          <span className="cza-ico" aria-hidden="true"><Users size={20} strokeWidth={1.9} /></span>
          <div className="cza-head-text">
            <h3 id="cza-title">ניהול גישת לקוחות</h3>
            <p>כל מייל רואה רק את הפרויקטים שסימנת. נשלח קישור כניסה חד-פעמי, והלקוח בוחר סיסמה בעצמו.</p>
          </div>
          <button type="button" className="cza-x" onClick={onClose} aria-label="סגירה"><X size={20} /></button>
        </header>

        {/* ── הוספה ── */}
        <section className="cza-card cza-add" aria-label="הוספת גישה">
          <label className="cza-label" htmlFor="cza-email">מייל איש קשר</label>
          <input id="cza-email" className="cza-input" type="email" dir="ltr" value={email}
            onChange={e => onEmailChange(e.target.value)} placeholder="client@example.com" autoComplete="off" />

          <div className="cza-row-between">
            <span className="cza-label">פרויקטים <span className="cza-count">{projectIds.length}/{allIds.length}</span></span>
            <button type="button" className="cza-link" onClick={() => setProjectIds(allOn ? [] : allIds)}>{allOn ? 'נקה הכל' : 'בחר הכל'}</button>
          </div>
          <div className="cza-clients">
            {groups.length === 0 && <div className="cza-empty">אין פרויקטים להצגה. אם זה הטלפון - ודא שאתה מחובר כאדמין.</div>}
            {groups.map(cl => {
              const ids = cl.projects.map(p => p.id)
              const n = ids.filter(id => projectIds.includes(id)).length
              const all = n === ids.length
              return (
                <div key={cl.id} className="cza-client">
                  <button type="button" className={'cza-client-name' + (n ? ' on' : '')}
                    onClick={() => setProjectIds(prev => all ? prev.filter(id => !ids.includes(id)) : Array.from(new Set([...prev, ...ids])))}
                    aria-pressed={all}>
                    <span className={'cza-box' + (all ? ' full' : n ? ' part' : '')} aria-hidden="true">{all ? <Check size={12} strokeWidth={3} /> : null}</span>
                    {cl.name}
                  </button>
                  <div className="cza-chips">
                    {cl.projects.map(pr => {
                      const on = projectIds.includes(pr.id)
                      return (
                        <button key={pr.id} type="button" className={'cza-chip' + (on ? ' on' : '')} onClick={() => onToggleProject(pr.id)} aria-pressed={on}>
                          {on ? <Check size={13} strokeWidth={2.6} aria-hidden="true" /> : <Plus size={13} strokeWidth={2.4} aria-hidden="true" />}{pr.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {emailExists && (
            <div className="cza-warn">
              <b>למייל הזה כבר יש גישה</b> (הסימון למעלה משקף אותה). שמירה תעדכן את הפרויקטים, בלי לשלוח מייל.
              <label className="cza-check">
                <input type="checkbox" checked={resendPassword} onChange={e => setResendPassword(e.target.checked)} />
                לשלוח קישור כניסה חדש (שכח סיסמה / לא מצא את המייל). הסיסמה הקיימת לא משתנה.
              </label>
            </div>
          )}

          <button type="button" className="cza-primary" onClick={onSave} disabled={saving || !email || projectIds.length === 0}>
            {saving ? 'שומר…'
              : emailExists && !resendPassword ? `עדכון גישה בלי מייל${projectIds.length ? ` (${projectIds.length})` : ''}`
              : `הוספת גישה ושליחת קישור${projectIds.length ? ` (${projectIds.length})` : ''}`}
          </button>
        </section>

        {/* ── חשבונות קיימים ── */}
        <section className="cza-list" aria-label="חשבונות עם גישה">
          <div className="cza-row-between">
            <h4>חשבונות עם גישה <span className="cza-count">{accounts.length}</span></h4>
          </div>
          {accounts.length > 4 && (
            <div className="cza-search">
              <Search size={16} aria-hidden="true" />
              <input type="search" dir="ltr" value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש לפי מייל" aria-label="חיפוש לפי מייל" />
            </div>
          )}
          {shown.length === 0 && <div className="cza-empty">{accounts.length ? 'לא נמצא מייל כזה' : 'אין גישות מוגדרות עדיין'}</div>}
          {shown.map(acc => (
            <article key={acc.email} className="cza-acc">
              <div className="cza-acc-head">
                <span className="cza-acc-mail" dir="ltr">{acc.email}</span>
                <span className="cza-acc-n">{acc.total} פרויקטים</span>
              </div>
              {acc.clients.map(c => {
                const all = clients.find(x => x.id === c.clientId)?.projects || []
                const granted = new Set(c.rows.map(r => r.project_id))
                const missing = all.filter(p => !granted.has(p.id))
                return (
                  <div key={c.clientId} className="cza-acc-client">
                    <div className="cza-row-between">
                      <span className="cza-acc-cname">{c.clientName}</span>
                      <button type="button" className="cza-icon-btn danger" onClick={() => onDeleteClient(acc.email, c.clientId)}
                        title={`הסרת כל הגישה של ${acc.email} ל-${c.clientName}`} aria-label={`הסרת כל הגישה ל-${c.clientName}`}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="cza-chips">
                      {c.rows.map(row => (
                        <span key={row.id} className="cza-chip on static">
                          {row.projects?.name || '-'}
                          <button type="button" className="cza-chip-x" onClick={() => onRemoveRow(row)} aria-label={`הסרת הגישה ל-${row.projects?.name || 'פרויקט'}`} title="הסרת הגישה לפרויקט"><X size={12} strokeWidth={2.6} /></button>
                        </span>
                      ))}
                      {missing.map(p => (
                        <button key={p.id} type="button" className="cza-chip add" onClick={() => onGrantProject(acc.email, c.clientId, c.rows, p.id)} title="הוספת גישה (בלי מייל ללקוח)">
                          <Plus size={13} strokeWidth={2.4} aria-hidden="true" />{p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </article>
          ))}
        </section>

        {/* ── PRO ── */}
        <section className="cza-list" aria-label="מנויי PRO">
          <h4>מנויי PRO</h4>
          <p className="cza-sub">PRO פותח את טאב <b>ישיבות שיווק</b> בצד הלקוח, לכל הפרויקטים של הלקוח. השינוי נכנס לתוקף מיד.</p>
          <div className="cza-plans">
            {clients.map(cl => {
              const isPro = cl.plan === 'pro'
              return (
                <div key={cl.id} className="cza-plan">
                  <span className="cza-plan-name">{cl.name}{isPro && <span className="cza-pro"><Crown size={11} aria-hidden="true" />PRO</span>}</span>
                  <button type="button" className={'cza-ghost' + (isPro ? '' : ' brand')} onClick={() => onSetPlan(cl.id, isPro ? 'basic' : 'pro')}>
                    {isPro ? 'הורדה ל-Basic' : 'שדרוג ל-PRO'}
                  </button>
                </div>
              )
            })}
          </div>
        </section>

        <p className="cz-note cza-foot"><span className="cz-note-label">כניסת לקוחות</span><span dir="ltr">{loginUrl}</span></p>
      </div>
    </div>
  )
}

/** החלון שאחרי יצירת גישה: הפרטים, והעתקה לוואטסאפ או של הקישור. */
export function AccessCredsModal({ creds, onClose, onCopied }) {
  const wa = `שלום 👋\nנוצרה עבורך גישה לדשבורד${creds.clientName ? ' של ' + creds.clientName : ''}.\n\nשם משתמש: ${creds.email}\nלכניסה ראשונה ובחירת סיסמה (קישור חד-פעמי):\n${creds.inviteLink}\n\nכניסות הבאות: ${creds.loginUrl}`
  const copy = async (text, msg) => {
    try { await navigator.clipboard.writeText(text); onCopied(msg) } catch { onCopied('ההעתקה נחסמה. סמנו את הטקסט והעתיקו ידנית') }
  }
  return (
    <div className="modal-overlay active" onClick={e => { if (e.target === e.currentTarget) onClose() }} style={{ zIndex: 9999 }}>
      <div className="modal cza-sheet cza-creds" role="dialog" aria-modal="true" aria-labelledby="cza-creds-title" dir="rtl">
        <header className="cza-head">
          <span className="cza-ico" aria-hidden="true"><KeyRound size={20} strokeWidth={1.9} /></span>
          <div className="cza-head-text">
            <h3 id="cza-creds-title">הגישה נוצרה</h3>
            {creds.clientName && <p>{creds.clientName}</p>}
          </div>
          <button type="button" className="cza-x" onClick={onClose} aria-label="סגירה"><X size={20} /></button>
        </header>
        <div className={'cza-status ' + (creds.emailSent ? 'ok' : 'warn')}>
          {creds.emailSent ? 'נשלח במייל קישור כניסה חד-פעמי. הלקוח בוחר סיסמה בעצמו.' : 'המייל לא נשלח. שלחו את הקישור ידנית. הוא לשימוש חד-פעמי.'}
        </div>
        <dl className="cza-creds-list">
          <div><dt>כתובת כניסה</dt><dd dir="ltr">{creds.loginUrl}</dd></div>
          <div><dt>שם משתמש</dt><dd dir="ltr">{creds.email}</dd></div>
          <div><dt>קישור לכניסה ראשונה</dt><dd dir="ltr" className="cza-link-box"><Link2 size={14} aria-hidden="true" />{creds.inviteLink}</dd></div>
        </dl>
        <p className="cza-sub">לא לפתוח את הקישור בדפדפן שבו אתם מחוברים כאדמין: הכניסה תחליף את החיבור שלכם.</p>
        <div className="cza-actions">
          <button type="button" className="cza-primary wa" onClick={() => copy(wa, 'הודעת הוואטסאפ הועתקה')}><MessageCircle size={17} aria-hidden="true" />העתקת הודעת וואטסאפ</button>
          <button type="button" className="cza-ghost" onClick={() => copy(creds.inviteLink, 'הקישור הועתק')}><Copy size={16} aria-hidden="true" />העתקת הקישור</button>
        </div>
      </div>
    </div>
  )
}
