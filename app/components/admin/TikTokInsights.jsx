'use client';

/**
 * TikTokInsights — כל מה שבטאב TikTok מתחת לטבלת הקמפיינים (ויטלי, 10.11: "תעשה את כולם ואז נמחק").
 * חמישה חלקים, כל אחד מוסתר כשאין לו נתונים — כך קל למחוק אחר כך חלק שלא שימושי:
 *   1. ניסוי A/B — דף נחיתה מול טופס מיידי, מהמודעה ועד הרשמות וחוזים ב-CRM
 *   2. צפיות בסרטונים — לכל מודעה: עצרו לצפות, צפו 6 שניות, 25/50/75/100%, זמן צפייה
 *   3. גלריית מודעות — שער הסרטון או הפוסט עצמו (Spark), עם הוצאה ולידים
 *   4. קהלים — מגדר, גיל, אזור, מערכת הפעלה
 *   5. מעורבות — לייקים, תגובות, שיתופים, עוקבים, כניסות לפרופיל, reach ותדירות
 *
 * insights — summary.insights משורת ה-tiktok (lib/ads/tiktok-insights.js), רק לתקופות המוכנות.
 * split — summary.tiktokSplit משורת ה-CRM (lib/crm/fireberry-summary.js).
 * rows — שורות המודעות של התקופה (ad_daily), למקרה שאין insights.
 */
import { useState } from 'react';
import { formatCurrency, formatNum } from '../../../lib/helpers';

const pct = (a, b) => (b > 0 ? (a / b) * 100 : null);
const fmtPct = (v) => (v == null ? '-' : (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + '%');
const cost = (spend, n) => (n > 0 ? formatCurrency(spend / n) : '-');
const variantOf = (campaign) => (/-B-|instant/i.test(campaign || '') ? 'B' : /-A-|landing|\blp\b/i.test(campaign || '') ? 'A' : null);

const GENDER = { MALE: 'גברים', FEMALE: 'נשים', NONE: 'לא ידוע', UNKNOWN: 'לא ידוע' };
const PLATFORM = { ANDROID: 'אנדרואיד', IPHONE: 'אייפון', IPAD: 'אייפד', IOS: 'iOS', PC: 'מחשב', UNKNOWN: 'לא ידוע' };
const ageLabel = (k) => { const m = String(k).match(/AGE_(\d+)_(\d+|MORE)/i); return m ? (m[2].toUpperCase() === 'MORE' ? m[1] + '+' : m[1] + '-' + m[2]) : (k === 'NONE' ? 'לא ידוע' : k); };

function Section({ icon, color = 'sky', title, sub, children }) {
  return (
    <div className="section">
      <div className="section-head">
        <div className={'ico ' + color}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg></div>
        <h2>{title}</h2>{sub ? <span className="sub">{sub}</span> : null}
      </div>
      {children}
    </div>
  );
}

const box = { background: 'var(--card,#fff)', border: '1px solid var(--border,#dce3f1)', borderRadius: 12, padding: 16 };

function SplitTest({ rows, split }) {
  const ads = { A: { spend: 0, leads: 0, clicks: 0, impressions: 0 }, B: { spend: 0, leads: 0, clicks: 0, impressions: 0 } };
  for (const r of rows || []) { const v = variantOf(r.campaign); if (!v) continue; const o = ads[v]; o.spend += +r.spend || 0; o.leads += +r.leads || 0; o.clicks += +r.clicks || 0; o.impressions += +r.impressions || 0; }
  const crm = Object.fromEntries((split || []).map(s => [s.variant, s]));
  if (!ads.A.spend && !ads.B.spend && !(split || []).length) return null;
  const col = (v, title, subtitle) => {
    const a = ads[v], c = crm[v] || {};
    const line = (label, value, hint) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border,#eef1f7)' }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontWeight: 700 }}>{value}{hint ? <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: 12, marginInlineStart: 6 }}>{hint}</span> : null}</span>
      </div>
    );
    return (
      <div style={{ ...box, flex: '1 1 280px', minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{title}</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 12.5, marginBottom: 8 }}>{subtitle}</div>
        {line('הוצאה', formatCurrency(a.spend))}
        {line('לידים (TikTok)', formatNum(a.leads), 'עלות ' + cost(a.spend, a.leads))}
        {line('אחוז המרה מקליק', fmtPct(pct(a.leads, a.clicks)))}
        {line('לידים ב-CRM', formatNum(c.leads || 0), c.leads ? 'רלוונטיים ' + formatNum(c.relevantLeads || 0) + ' (' + fmtPct(pct(c.relevantLeads || 0, c.leads)) + ')' : null)}
        {line('פגישות שתואמו', formatNum(c.meetings || 0), 'עלות ' + cost(a.spend, c.meetings || 0))}
        {line('פגישות שבוצעו', formatNum(c.meetingsCompleted || 0))}
        {line('הרשמות', formatNum(c.registrations || 0), 'עלות ' + cost(a.spend, c.registrations || 0))}
        {line('חוזים', formatNum(c.contracts || 0), 'עלות ' + cost(a.spend, c.contracts || 0))}
      </div>
    );
  };
  const unknown = crm['?'];
  return (
    <Section color="violet" title="ניסוי A/B: דף נחיתה מול טופס מיידי" sub="מהמודעה ועד החוזה" icon={<><path d="M3 3h7v7H3z" /><path d="M14 14h7v7h-7z" /><path d="M14 3h7v7h-7z" /><path d="M3 14h7v7H3z" /></>}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {col('A', 'A - דף נחיתה', 'הגולש עובר לאתר וממלא שם את הטופס')}
        {col('B', 'B - טופס מיידי', 'הטופס נפתח בתוך TikTok')}
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 12.5, marginTop: 10 }}>
        {'הלידים ב-CRM לפי מקור "טיקטוק" ב-Fireberry: B לפי שם הקמפיין או "TikTok Instant Form", A לפי גרסת דף הנחיתה. ' +
          'פגישות, הרשמות וחוזים נספרים לפי מועד הפעולה בתקופה.' + (unknown?.leads ? ` ${unknown.leads} לידים מטיקטוק בלי סימן לגרסה לא נכללו.` : '')}
      </p>
    </Section>
  );
}

function VideoTable({ stats }) {
  const rows = (stats || []).filter(s => s.video_play_actions > 0 || s.video_watched_2s > 0).sort((a, b) => b.spend - a.spend);
  if (!rows.length) return null;
  return (
    <Section color="rose" title="צפיות בסרטונים" sub="כמה עצרו לצפות וכמה נשארו עד הסוף" icon={<><polygon points="5 3 19 12 5 21 5 3" /></>}>
      <div className="table-wrapper"><table className="data-table"><thead><tr>
        <th style={{ textAlign: 'start' }}>מודעה</th><th>הוצאה</th><th>חשיפות</th>
        <th title="צפו לפחות 2 שניות, מתוך החשיפות">עצרו לצפות</th><th title="צפו לפחות 6 שניות, מתוך החשיפות">צפו 6 שניות</th>
        <th>25%</th><th>50%</th><th>75%</th><th title="צפו בסרטון עד הסוף, מתוך מי שהתחיל">עד הסוף</th>
        <th>זמן צפייה ממוצע</th><th>לידים</th><th>עלות לליד</th>
      </tr></thead><tbody>
        {rows.map(s => {
          const plays = s.video_play_actions || 0;
          return (
            <tr key={s.adId}>
              <td dir="rtl" style={{ textAlign: 'start', fontWeight: 600, whiteSpace: 'normal' }}><bdi>{s.adName}</bdi></td>
              <td>{formatCurrency(s.spend)}</td><td>{formatNum(s.impressions)}</td>
              <td>{fmtPct(pct(s.video_watched_2s, s.impressions))}</td><td>{fmtPct(pct(s.video_watched_6s, s.impressions))}</td>
              <td>{fmtPct(pct(s.video_views_p25, plays))}</td><td>{fmtPct(pct(s.video_views_p50, plays))}</td>
              <td>{fmtPct(pct(s.video_views_p75, plays))}</td><td>{fmtPct(pct(s.video_views_p100, plays))}</td>
              <td>{s.average_video_play ? s.average_video_play.toFixed(1) + ' שנ׳' : '-'}</td>
              <td>{formatNum(s.leads)}</td><td>{cost(s.spend, s.leads)}</td>
            </tr>
          );
        })}
      </tbody></table></div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 12.5, marginTop: 8 }}>"עצרו לצפות" ו"צפו 6 שניות" - מתוך החשיפות. 25% עד "עד הסוף" - מתוך מי שהתחיל לצפות.</p>
    </Section>
  );
}

function Gallery({ stats, media }) {
  const [open, setOpen] = useState(null);
  const rows = (stats || []).filter(s => s.spend > 0).sort((a, b) => (b.leads - a.leads) || (b.spend - a.spend));
  if (!rows.length) return null;
  return (
    <Section color="amber" title="המודעות" sub="לפי לידים" icon={<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
        {rows.map(s => {
          const m = (media || {})[s.adId] || {};
          const showEmbed = open === s.adId && m.itemId;
          return (
            <div key={s.adId} style={{ ...box, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ position: 'relative', aspectRatio: '9/16', background: '#000' }}>
                {showEmbed ? (
                  <iframe title={s.adName} src={`https://www.tiktok.com/embed/v2/${encodeURIComponent(m.itemId)}`} style={{ width: '100%', height: '100%', border: 0 }} allow="encrypted-media; fullscreen" loading="lazy" />
                ) : m.preview && open === s.adId ? (
                  <video src={m.preview} poster={m.cover || undefined} controls autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                ) : (
                  <button type="button" onClick={() => setOpen(s.adId)} disabled={!m.itemId && !m.preview}
                    style={{ all: 'unset', cursor: (m.itemId || m.preview) ? 'pointer' : 'default', display: 'block', width: '100%', height: '100%' }} aria-label={'הצג את ' + s.adName}>
                    {m.cover ? <img src={m.cover} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : null}
                    <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, background: m.cover ? 'rgba(0,0,0,.25)' : 'transparent' }}>
                      {(m.itemId || m.preview) ? '▶ הצג סרטון' : 'אין תצוגה'}
                    </span>
                  </button>
                )}
              </div>
              <div style={{ padding: 12 }}>
                <div dir="rtl" style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}><bdi>{s.adName}</bdi></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 12.5 }}>
                  <span>הוצאה <b>{formatCurrency(s.spend)}</b></span><span>לידים <b>{formatNum(s.leads)}</b></span>
                  <span>עלות לליד <b>{cost(s.spend, s.leads)}</b></span><span>CTR <b>{fmtPct(pct(s.clicks, s.impressions))}</b></span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function Bars({ title, rows, label }) {
  const total = rows.reduce((t, r) => t + r.spend, 0);
  if (!rows.length || total <= 0) return null;
  return (
    <div style={{ ...box, flex: '1 1 240px', minWidth: 0 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{title}</div>
      {rows.slice(0, 8).map(r => {
        const share = (r.spend / total) * 100;
        return (
          <div key={r.key} style={{ marginBottom: 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
              <span>{label(r.key)}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{fmtPct(share)} מההוצאה · {formatNum(r.clicks)} קליקים{r.leads ? ' · ' + formatNum(r.leads) + ' לידים' : ''}</span>
            </div>
            <div style={{ height: 7, borderRadius: 4, background: 'var(--border,#eef1f7)' }}><div style={{ width: share + '%', height: '100%', borderRadius: 4, background: 'var(--indigo,#5B5EF4)' }} /></div>
          </div>
        );
      })}
    </div>
  );
}

function Audience({ audience }) {
  const a = audience || {};
  if (![a.gender, a.age, a.region, a.platform].some(x => (x || []).length)) return null;
  return (
    <Section color="indigo" title="קהלים" sub="למי TikTok הציג את המודעות" icon={<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Bars title="מגדר" rows={a.gender || []} label={k => GENDER[k] || k} />
        <Bars title="גיל" rows={a.age || []} label={ageLabel} />
        <Bars title="אזור" rows={(a.region || []).map(r => ({ ...r, key: r.name || r.key }))} label={k => (/^\d+$/.test(k) ? 'אזור ' + k : k)} />
        <Bars title="מכשיר" rows={a.platform || []} label={k => PLATFORM[k] || k} />
      </div>
    </Section>
  );
}

function Engagement({ stats, account }) {
  const t = { likes: 0, comments: 0, shares: 0, follows: 0, profile_visits: 0 };
  for (const s of stats || []) for (const k of Object.keys(t)) t[k] += s[k] || 0;
  const any = Object.values(t).some(v => v > 0) || (account && account.reach > 0);
  if (!any) return null;
  const tile = (label, v) => (
    <div style={{ ...box, flex: '1 1 130px', textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{v}</div><div style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>{label}</div>
    </div>
  );
  return (
    <Section color="emerald" title="מעורבות וחשיפה" icon={<><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" /></>}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {account?.reach > 0 && tile('אנשים שראו (reach)', formatNum(account.reach))}
        {account?.frequency > 0 && tile('תדירות ממוצעת', account.frequency.toFixed(2))}
        {tile('לייקים', formatNum(t.likes))}{tile('תגובות', formatNum(t.comments))}{tile('שיתופים', formatNum(t.shares))}
        {tile('עוקבים חדשים', formatNum(t.follows))}{tile('כניסות לפרופיל', formatNum(t.profile_visits))}
      </div>
    </Section>
  );
}

export default function TikTokInsights({ insights, split, rows }) {
  const stats = insights?.adStats || [];
  return (
    <>
      <SplitTest rows={rows} split={split} />
      {insights ? (<>
        <VideoTable stats={stats} />
        <Gallery stats={stats} media={insights.media} />
        <Audience audience={insights.audience} />
        <Engagement stats={stats} account={insights.account} />
      </>) : (
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '14px 0' }}>
          צפיות בסרטונים, גלריית המודעות, קהלים ומעורבות מוצגים לתקופות המוכנות (היום, אתמול, 7/14/30 יום, החודש, רבעון). בטווח מותאם אישית - רק הנתונים שלמעלה.
        </p>
      )}
    </>
  );
}
