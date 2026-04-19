export const metadata = {
  title: 'VITAS Campaign Manager — Digital Marketing Reports',
  description: 'Unified marketing performance dashboard by VITAS. Consolidates Meta Ads and Google Ads data into a single reporting platform.',
}

// Logo rendered inline as SVG so it works without any external image upload
function Logo({ height = 90 }) {
  return (
    <svg
      viewBox="0 0 680 240"
      height={height}
      style={{ display: 'block' }}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="VITAS Campaign Manager"
    >
      <g fill="#e8e8e8" style={{ fontFamily: "'Orbitron', 'Audiowide', sans-serif" }}>
        <text x="340" y="115" textAnchor="middle" fontSize="130" fontWeight="600" letterSpacing="22">VITAS</text>
        <text x="340" y="185" textAnchor="middle" fontSize="38" fontWeight="400" letterSpacing="14">CAMPAIGN MANAGER</text>
      </g>
    </svg>
  )
}

export default function Home() {
  return (
    <div
      dir="ltr"
      style={{
        fontFamily: "'Heebo', system-ui, sans-serif",
        background: '#0b1220',
        color: '#e2e8f0',
        minHeight: '100vh',
        margin: 0,
        textAlign: 'left',
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700&family=Heebo:wght@400;500;600;700;800;900&display=swap"
        rel="stylesheet"
      />

      {/* Header */}
      <header style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ color: '#e8e8e8' }}>
          <Logo height={60} />
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <a href="#contact" style={{ color: '#93c5fd', textDecoration: 'none', fontWeight: 500, fontSize: '0.95em' }}>Contact</a>
          <a href="/admin" style={{ background: '#3b82f6', color: 'white', padding: '10px 22px', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: '0.95em' }}>Admin Login →</a>
        </div>
      </header>

      {/* Hero */}
      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px 60px' }}>
        <h1 style={{ fontSize: '2.8em', fontWeight: 900, lineHeight: 1.1, margin: '0 0 20px', letterSpacing: '-0.5px', maxWidth: 900 }}>
          Unified Digital Marketing Reporting for Agencies and Advertisers
        </h1>
        <p style={{ fontSize: '1.15em', color: '#94a3b8', lineHeight: 1.7, margin: '0 0 26px', maxWidth: 820 }}>
          VITAS Campaign Manager is a proprietary reporting dashboard built by VITAS Digital Marketing. It consolidates campaign performance data from multiple advertising platforms — including Meta Ads (Facebook / Instagram) and Google Ads — into a single, unified interface that agencies and advertisers use to track spend, leads, cost-per-lead, and ad creative performance across all their clients and projects in real time.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ background: 'rgba(59,130,246,0.15)', color: '#93c5fd', padding: '6px 14px', borderRadius: 20, fontSize: '0.85em', fontWeight: 600 }}>Meta Marketing API</span>
          <span style={{ background: 'rgba(251,146,60,0.15)', color: '#fdba74', padding: '6px 14px', borderRadius: 20, fontSize: '0.85em', fontWeight: 600 }}>Google Ads API</span>
          <span style={{ background: 'rgba(16,185,129,0.15)', color: '#6ee7b7', padding: '6px 14px', borderRadius: 20, fontSize: '0.85em', fontWeight: 600 }}>Next.js + Supabase</span>
          <span style={{ background: 'rgba(139,92,246,0.15)', color: '#c4b5fd', padding: '6px 14px', borderRadius: 20, fontSize: '0.85em', fontWeight: 600 }}>Read-only API access</span>
        </div>
      </section>

      {/* Features */}
      <section style={{ background: '#111827', padding: '56px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <h2 style={{ fontSize: '1.9em', fontWeight: 800, marginTop: 0, marginBottom: 28 }}>What the platform does</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
            <div style={{ background: '#0b1220', padding: 24, borderRadius: 12, borderLeft: '4px solid #3b82f6' }}>
              <div style={{ fontSize: '1.05em', fontWeight: 700, marginBottom: 8 }}>Unified campaign performance</div>
              <div style={{ color: '#94a3b8', fontSize: '0.95em', lineHeight: 1.6 }}>
                Pulls insights from Meta Ads and Google Ads via their official APIs (read-only), aggregates by client and project, and shows spend, impressions, clicks, leads, CPL, CPM, CTR, frequency, and conversion rate in a single view.
              </div>
            </div>
            <div style={{ background: '#0b1220', padding: 24, borderRadius: 12, borderLeft: '4px solid #10b981' }}>
              <div style={{ fontSize: '1.05em', fontWeight: 700, marginBottom: 8 }}>Per-project dashboards</div>
              <div style={{ color: '#94a3b8', fontSize: '0.95em', lineHeight: 1.6 }}>
                Agency-style project breakdown — each client can have multiple active projects, each with its own monthly report, campaign tables, ad creative library, and demographic breakdowns.
              </div>
            </div>
            <div style={{ background: '#0b1220', padding: 24, borderRadius: 12, borderLeft: '4px solid #8b5cf6' }}>
              <div style={{ fontSize: '1.05em', fontWeight: 700, marginBottom: 8 }}>Month-over-month comparison</div>
              <div style={{ color: '#94a3b8', fontSize: '0.95em', lineHeight: 1.6 }}>
                Every KPI is displayed alongside the previous month&apos;s value, with automatic trend indicators so agencies can quickly see which campaigns are improving or declining.
              </div>
            </div>
            <div style={{ background: '#0b1220', padding: 24, borderRadius: 12, borderLeft: '4px solid #f59e0b' }}>
              <div style={{ fontSize: '1.05em', fontWeight: 700, marginBottom: 8 }}>Token-based client sharing</div>
              <div style={{ color: '#94a3b8', fontSize: '0.95em', lineHeight: 1.6 }}>
                Each client receives a private, token-protected URL where they can review their own campaign performance without needing any login. Row-level security ensures each client only sees their own data.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* API usage description (for Google reviewers) */}
      <section style={{ padding: '56px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <h2 style={{ fontSize: '1.9em', fontWeight: 800, marginTop: 0, marginBottom: 20 }}>How we use the Google Ads API</h2>
          <p style={{ color: '#94a3b8', lineHeight: 1.75, fontSize: '1em', maxWidth: 900 }}>
            VITAS Campaign Manager uses the Google Ads API in <strong style={{ color: '#e2e8f0' }}>read-only mode</strong> to retrieve campaign, ad group, ad, and performance metrics for the Google Ads accounts that our MCC manages. Retrieved data is transformed into a common schema — identical to the schema used for Meta Ads data — and stored in a Supabase Postgres database. Users of the platform view the data through the web dashboard; the API itself is never exposed directly to end users or clients.
          </p>
          <p style={{ color: '#94a3b8', lineHeight: 1.75, fontSize: '1em', maxWidth: 900, marginTop: 16 }}>
            The API is called either on demand by a logged-in agency employee (via a &quot;Refresh from Google Ads&quot; button) or automatically once per day via a scheduled Vercel Cron job. We do not create, modify, pause, or delete campaigns through the API — all campaign management is done by our team directly in the Google Ads UI. Refresh tokens are stored as encrypted environment variables in Vercel and are never written to source code or logs.
          </p>
        </div>
      </section>

      {/* Contact form */}
      <section id="contact" style={{ background: '#111827', padding: '64px 24px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <h2 style={{ fontSize: '1.9em', fontWeight: 800, marginTop: 0, marginBottom: 10, textAlign: 'center' }}>Get in touch</h2>
          <p style={{ color: '#94a3b8', textAlign: 'center', marginBottom: 36, fontSize: '1.02em', lineHeight: 1.6 }}>
            Interested in VITAS Campaign Manager? Leave your details and we&apos;ll get back to you.
          </p>

          <form
            action="https://formsubmit.co/vitali@vitas.co.il"
            method="POST"
            style={{ display: 'grid', gap: 16 }}
          >
            <input type="hidden" name="_subject" value="New lead from reports.vitas.co.il" />
            <input type="hidden" name="_template" value="table" />
            <input type="hidden" name="_captcha" value="false" />
            <input type="hidden" name="_next" value="https://reports.vitas.co.il/?submitted=1" />

            <div>
              <label style={{ display: 'block', fontSize: '0.9em', color: '#cbd5e1', marginBottom: 6, fontWeight: 500 }}>Full name *</label>
              <input
                type="text"
                name="name"
                required
                placeholder="John Doe"
                style={{ width: '100%', padding: '12px 14px', borderRadius: 8, border: '1px solid #334155', background: '#0b1220', color: '#e2e8f0', fontSize: '1em', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.9em', color: '#cbd5e1', marginBottom: 6, fontWeight: 500 }}>Phone *</label>
              <input
                type="tel"
                name="phone"
                required
                placeholder="+972 50 123 4567"
                style={{ width: '100%', padding: '12px 14px', borderRadius: 8, border: '1px solid #334155', background: '#0b1220', color: '#e2e8f0', fontSize: '1em', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.9em', color: '#cbd5e1', marginBottom: 6, fontWeight: 500 }}>Email *</label>
              <input
                type="email"
                name="email"
                required
                placeholder="you@example.com"
                style={{ width: '100%', padding: '12px 14px', borderRadius: 8, border: '1px solid #334155', background: '#0b1220', color: '#e2e8f0', fontSize: '1em', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.9em', color: '#cbd5e1', marginBottom: 6, fontWeight: 500 }}>Business name *</label>
              <input
                type="text"
                name="business"
                required
                placeholder="Your business name"
                style={{ width: '100%', padding: '12px 14px', borderRadius: 8, border: '1px solid #334155', background: '#0b1220', color: '#e2e8f0', fontSize: '1em', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>

            <button
              type="submit"
              style={{ background: '#3b82f6', color: 'white', padding: '14px 24px', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '1em', cursor: 'pointer', fontFamily: 'inherit', marginTop: 8 }}
            >
              Submit →
            </button>
          </form>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: '#080c14', padding: '26px 24px', textAlign: 'center', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', color: '#64748b', fontSize: '0.9em' }}>
          Built by <strong style={{ color: '#94a3b8' }}>VITAS Digital Marketing</strong> · Internal reporting tool · Contact: vitali@vitas.co.il
        </div>
      </footer>
    </div>
  )
}
