export const metadata = {
  title: 'VITAS Reports — Digital Marketing Dashboard',
  description: 'Unified marketing performance dashboard by VITAS Digital Marketing. Consolidates Meta Ads and Google Ads data into a single reporting interface.',
}

export default function Home() {
  return (
    <div style={{fontFamily: 'Heebo, system-ui, sans-serif', background: '#0f172a', color: '#e2e8f0', minHeight: '100vh', margin: 0}}>
      {/* Hero */}
      <div style={{maxWidth: 1100, margin: '0 auto', padding: '60px 24px 40px'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 60, flexWrap: 'wrap', gap: 16}}>
          <div style={{fontSize: '1.8em', fontWeight: 900, letterSpacing: 2, background: 'linear-gradient(135deg, #fff 0%, #60a5fa 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text'}}>VITAS REPORTS</div>
          <a href="/admin" style={{background: '#3b82f6', color: 'white', padding: '10px 24px', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: '0.95em'}}>Admin Login →</a>
        </div>

        <div style={{display: 'grid', gridTemplateColumns: '1fr', gap: 40, alignItems: 'center'}}>
          <div>
            <h1 style={{fontSize: '2.8em', fontWeight: 900, lineHeight: 1.1, margin: '0 0 20px', letterSpacing: '-0.5px'}}>
              Unified Digital Marketing Reporting for Agencies and Advertisers
            </h1>
            <p style={{fontSize: '1.15em', color: '#94a3b8', lineHeight: 1.7, margin: '0 0 30px', maxWidth: 800}}>
              VITAS Reports is a proprietary reporting dashboard built by VITAS Digital Marketing. It consolidates campaign performance data from multiple advertising platforms — including Meta Ads (Facebook/Instagram) and Google Ads — into a single, unified interface that agencies and advertisers use to track spend, leads, cost-per-lead, and ad creative performance across all their clients and projects in real time.
            </p>
            <div style={{display: 'flex', gap: 12, flexWrap: 'wrap'}}>
              <span style={{background: 'rgba(59,130,246,0.15)', color: '#93c5fd', padding: '6px 14px', borderRadius: 20, fontSize: '0.85em', fontWeight: 600}}>Meta Marketing API</span>
              <span style={{background: 'rgba(251,146,60,0.15)', color: '#fdba74', padding: '6px 14px', borderRadius: 20, fontSize: '0.85em', fontWeight: 600}}>Google Ads API</span>
              <span style={{background: 'rgba(16,185,129,0.15)', color: '#6ee7b7', padding: '6px 14px', borderRadius: 20, fontSize: '0.85em', fontWeight: 600}}>Next.js + Supabase</span>
              <span style={{background: 'rgba(139,92,246,0.15)', color: '#c4b5fd', padding: '6px 14px', borderRadius: 20, fontSize: '0.85em', fontWeight: 600}}>Read-only API access</span>
            </div>
          </div>
        </div>
      </div>

      {/* Features */}
      <div style={{background: '#1e293b', padding: '50px 24px'}}>
        <div style={{maxWidth: 1100, margin: '0 auto'}}>
          <h2 style={{fontSize: '1.8em', fontWeight: 800, marginTop: 0, marginBottom: 30}}>What the platform does</h2>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20}}>
            <div style={{background: '#0f172a', padding: 24, borderRadius: 12, borderRight: '4px solid #3b82f6'}}>
              <div style={{fontSize: '1.05em', fontWeight: 700, marginBottom: 8}}>Unified campaign performance</div>
              <div style={{color: '#94a3b8', fontSize: '0.95em', lineHeight: 1.6}}>
                Pulls insights from Meta Ads and Google Ads via their official APIs (read-only), aggregates by client and project, and displays spend, impressions, clicks, leads, CPL, CPM, CTR, frequency, and conversion rate in a single view.
              </div>
            </div>
            <div style={{background: '#0f172a', padding: 24, borderRadius: 12, borderRight: '4px solid #10b981'}}>
              <div style={{fontSize: '1.05em', fontWeight: 700, marginBottom: 8}}>Per-project dashboards</div>
              <div style={{color: '#94a3b8', fontSize: '0.95em', lineHeight: 1.6}}>
                Agency-style project breakdown — each client can have multiple active projects, each with its own monthly report, campaign tables, ad creative library, and demographic breakdowns.
              </div>
            </div>
            <div style={{background: '#0f172a', padding: 24, borderRadius: 12, borderRight: '4px solid #8b5cf6'}}>
              <div style={{fontSize: '1.05em', fontWeight: 700, marginBottom: 8}}>Month-over-month comparison</div>
              <div style={{color: '#94a3b8', fontSize: '0.95em', lineHeight: 1.6}}>
                Every KPI is displayed alongside the previous month&apos;s value, with automatic trend indicators so agencies can quickly identify which campaigns are improving or declining.
              </div>
            </div>
            <div style={{background: '#0f172a', padding: 24, borderRadius: 12, borderRight: '4px solid #f59e0b'}}>
              <div style={{fontSize: '1.05em', fontWeight: 700, marginBottom: 8}}>Token-based client sharing</div>
              <div style={{color: '#94a3b8', fontSize: '0.95em', lineHeight: 1.6}}>
                Each client receives a private, token-protected URL where they can review their own campaign performance without needing any login or account. Row-level-security ensures each client only ever sees their own data.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* API use */}
      <div style={{padding: '50px 24px'}}>
        <div style={{maxWidth: 1100, margin: '0 auto'}}>
          <h2 style={{fontSize: '1.8em', fontWeight: 800, marginTop: 0, marginBottom: 20}}>How we use the Google Ads API</h2>
          <p style={{color: '#94a3b8', lineHeight: 1.7, fontSize: '1em', maxWidth: 900}}>
            VITAS Reports uses the Google Ads API in <strong style={{color: '#e2e8f0'}}>read-only mode</strong> to retrieve campaign, ad group, ad, and performance metrics for the Google Ads accounts that our MCC manages. The retrieved data is transformed into a common schema — identical to the schema used for Meta Ads data — and stored in a Supabase Postgres database. Users of the platform view the data through the web dashboard; the API itself is never exposed directly to end users or clients.
          </p>
          <p style={{color: '#94a3b8', lineHeight: 1.7, fontSize: '1em', maxWidth: 900, marginTop: 16}}>
            The API is called either on-demand by a logged-in agency employee (via a &quot;Refresh from Google Ads&quot; button) or automatically once per day via a scheduled Vercel Cron job. We do not create, modify, pause, or delete campaigns through the API — all changes to ad campaigns are made by our team directly in the Google Ads UI. Refresh tokens are stored as encrypted environment variables in Vercel and are never written to source code or logs.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div style={{background: '#0a101f', padding: '30px 24px', textAlign: 'center', borderTop: '1px solid rgba(255,255,255,0.06)'}}>
        <div style={{maxWidth: 1100, margin: '0 auto', color: '#64748b', fontSize: '0.9em'}}>
          Built by <strong style={{color: '#94a3b8'}}>VITAS Digital Marketing</strong> · Internal reporting tool · Contact: vitali@vitas.co.il
        </div>
      </div>
    </div>
  )
}
