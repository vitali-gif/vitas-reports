# Design v2 (Hi-Tech Refresh) — Implementation Playbook

> **For Sonnet (next chat) — read this before doing anything.**
> Written by Opus 2026-05-24 at the end of a foundation session.

---

## Context in one paragraph

VITAS Reports (Next.js 14 dashboard) had a "VITAS Editorial" design applied in May 2026 (commit `4ff6869`) — warm sand/plum palette. Vitali rejected it after seeing it live and commissioned a second handoff from Claude Design called **"Hi-Tech Refresh"** (`design_handoff_vitas_hitech_refresh/` in `C:\dev\reports dashboard\`). We're migrating to the v2 design 1-to-1 on branch `design-v2` while preserving 100% of the backend, data layer, Impact Tracking (Stages 1-5), Meta automated rules feature, and CRM analytics.

---

## Source of truth for the design

All mockups live in `C:\dev\reports dashboard\design_handoff_vitas_hitech_refresh\`:
- `README.md` (28KB) — comprehensive spec
- `screen-2-hakol-v2.html` — Overview tab
- `screen-3-crm.html` — CRM tab
- `screen-4-facebook.html` — Facebook tab
- `screen-5-google.html` — Google tab
- `screen-6-recommendations.html` — Recommendations tab

The mockups are self-contained HTML with all CSS inline. **Fidelity: 1-to-1, pixel-perfect.**

---

## Architecture decisions made (don't re-litigate)

### 1. Drop-in `globals.css` replacement WITH aliases

The old admin/page.js JSX references ~121 class names. The new globals.css defines BOTH the new v2 names AND aliases for the old names. This means the first commit (globals.css only) shifts the entire visual identity without touching JSX.

Color-modifier aliases verified against admin/page.js:

```
.kpi-card.green  -> v2 emerald  (פגישות שבוצעו)
.kpi-card.orange -> v2 terra    (פגישות שתואמו)
.kpi-card.pink   -> v2 rose     (עלות לליד)
.kpi-card.purple -> v2 violet   (תקציב)
.kpi-card.cyan   -> v2 sky      (חוזים)
.kpi-card.red    -> v2 amber    (הרשמות)
.kpi-card (no modifier) -> v2 indigo  (לידים)
```

### 2. Heebo dual-load
layout.js loads Heebo 300-900 from Google Fonts CDN; globals.css also has self-hosted @font-face. Don't remove either.

### 3. lucide-react installed but unused yet
Switching emojis to SVG icons is its own ticket after visual shift is approved.

### 4. Chart.js already installed (v4.4.1)
Use `import Chart from 'chart.js/auto'` to match existing pattern.

### 5. No new routing — keep `activeTab` state-based pattern

### 6. Branch strategy
- All work on `design-v2`
- Each chunk = own commit -> Vercel preview
- Never merge to main until visually approved

---

## Order of implementation

### Done in foundation session:
- [x] Branch `design-v2`
- [x] `docs/design-v2-playbook.md` (this file)
- [x] New `app/globals.css` (v2 tokens + aliases)
- [x] `app/layout.js` updated (Heebo 300-900)
- [ ] Dependencies (`npm install lucide-react react-chartjs-2`) — see commit log
- [ ] Shell components extraction — see commit log
- [ ] Screen-2 Overview tab restructure — see commit log

### To be done by Sonnet:
1. **Verify visual shift on preview URL**
2. **Shell components**: extract `app/components/shell/Header.jsx`, `Sidebar.jsx`, `TitleBar.jsx`, `Tabs.jsx`
3. **Screen-2 (הכל / Overview)** — most important
4. **Screen-3 (CRM)** — biggest, 14 KPIs + 4 sub-tabs + 4 Chart.js
5. **Screen-4 (Facebook)** — copy pattern from Screen-2
6. **Screen-5 (Google)** — Screen-2 + 2 charts + PMax + asset-groups
7. **Screen-6 (Recommendations)** — accordions + 28-day timer
   - **CRITICAL**: Preserve "צור כלל אוטומטי" button for Meta rules (mockup omits it). Existing handler: `createMetaRule(ruleType, params, recKey)`.

### Out of scope:
- Meta rule creation modal (keep existing markup)
- Welcome / empty state
- Mobile responsive
- Dark mode

---

## Things that MUST keep working

| Feature | Smoke test |
|---|---|
| Login + Supabase auth | Open /admin, log in, see client list |
| Project selection | Click HI PARK/ONCE/REHAVIA -> re-fetches |
| Date range fetching | Period change re-fetches Meta/Google/CRM |
| Impact Tracking pipeline | Lock button -> vitas_tasks row -> 28-day timer |
| Meta automated rules | "צור כלל אוטומטי" -> dialog -> POST /api/meta/rules |
| InfoTip popovers | Click info icon -> popover with explanation |
| Day-of-week chart | CRM > זמני תגובה renders bar chart |
| CRM response time histogram | Buckets + conversion % |
| Cities donut | Top 10 cities |
| Objections donut | Top 10 objections |

---

## Pitfalls (read before coding)

### renderDashboard useCallback deps array
Around line ~2380 of admin/page.js (END of the useCallback). Any new useState read inside MUST be added there. Past incidents: recSubTab, vitasTasks, lockingRecKey were missed -> sub-tab clicks didn't re-render (commit 5a1b92c fix).

### Hebrew slugs
Use `decodeURIComponent(params.slug)` in dynamic routes.

### CSS aliases
Always check both directions when adding new classes.

### RTL + grid order
Past incident (commit 4360250): RTL flipped a 2-column grid the wrong way. Use `grid-template-columns: 260px 1fr` and let `dir="rtl"` handle the flip. Do NOT add `direction: ltr` to the grid.

### Supabase source constraint
`source` column accepts only `crm`, `facebook`, `google`. Not `crm_reports`.

### Anon key public
Embedded in client bundle. Writes go via API routes using service role.

### Meta CPL field
Possibly wrong: `cost_per_inline_link_click` should maybe be `cost_per_action_type:offsite_conversion.fb_pixel_lead`. Not yet validated.

---

## How to push

```bash
cd /tmp/vitas-reports
git remote set-url origin "https://vitali-gif:${GH_PAT}@github.com/vitali-gif/vitas-reports.git"
git add -A
git commit -m "v2: <what you did>"
node --check app/admin/page.js   # MANDATORY before push
git push origin design-v2
```

Wait 60-90s after push for Vercel preview to build.
Preview URL pattern: `https://vitas-reports-git-design-v2-vitali-gif.vercel.app`

---

## Vitali's preferences

- Hebrew responses
- Action over explanation, concise
- Live GitHub edits, not local
- Trust autonomous action when he's unavailable
- Provide computer:// links or URLs for review
- Show before/after when possible

---

## End-of-session status

(Filled in by Opus at end of foundation session — see git log + last commit messages.)
