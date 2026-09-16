/**
 * lib/ads/meta-api.js — קריאות בסיס ל-Meta Marketing API, משותפות ל-meta/fetch (הדוחות
 * השמורים) ול-ads/daily-sync (העובדות היומיות). הועברו מ-app/api/meta/fetch/route.js
 * כמו שהן (שלב 2 של docs/daily-ranges-plan.md).
 */
export const META_GRAPH_VERSION = 'v21.0'

export function num(v) {
  if (typeof v === 'number') return v
  if (!v) return 0
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? 0 : n
}

// Extract leads count from Meta actions array.
// Meta returns BOTH an aggregate 'lead' action AND specific sub-types (onsite_conversion.lead_grouped, etc).
// Summing them all double-counts. So we pick ONE source by priority to match what Ads Manager shows.
export function extractLeads(actions) {
  if (!Array.isArray(actions)) return 0
  const getByType = (type) => {
    for (const a of actions) {
      if (a && a.action_type === type) return num(a.value)
    }
    return null
  }
  // Each ad's "result" = the conversion its campaign optimizes for (matches Ads Manager "Results"):
  //   lead-form campaigns  -> onsite_conversion.lead_grouped (on-Facebook Instant Forms)
  //   conversion campaigns -> custom conversion "LEAD | 2025" (offsite_conversion.custom.1586162569238898)
  // An ad belongs to one campaign type, so max() picks its real result with no double-counting.
  // Accounts without that custom conversion (e.g. ש.ברוך) -> lead2025 is null -> behaves like lead_grouped.
  const leadGrouped = getByType('onsite_conversion.lead_grouped')
  const lead2025 = getByType('offsite_conversion.custom.1586162569238898')
  if (leadGrouped !== null || lead2025 !== null) return Math.max(leadGrouped || 0, lead2025 || 0)
  // Fallbacks for rows/accounts without either of the above
  let v = getByType('offsite_conversion.fb_pixel_lead')
  if (v !== null) return v
  v = getByType('leadgen.other')
  if (v !== null) return v
  v = getByType('lead')
  return v !== null ? v : 0
}

export async function metaFetchAll(url, token) {
  const out = []
  let next = url
  let safety = 0
  while (next && safety < 50) {
    const sep = next.includes('?') ? '&' : '?'
    const full = next.includes('access_token=') ? next : `${next}${sep}access_token=${encodeURIComponent(token)}`
    const res = await fetch(full)
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Meta API ${res.status}: ${txt.slice(0, 400)}`)
    }
    const json = await res.json()
    if (Array.isArray(json.data)) out.push(...json.data)
    next = json.paging && json.paging.next ? json.paging.next : null
    safety++
  }
  return out
}

/** כל חשבונות המודעות המוגדרים (legacy יחיד + רשימה), בלי כפילויות. */
export function metaAccountIds() {
  return [...new Set([
    ...(process.env.META_AD_ACCOUNT_ID || '').split(','),
    ...(process.env.META_AD_ACCOUNT_IDS || '').split(','),
  ].map((s) => s.trim()).filter(Boolean))]
}

/** הטוקן של חשבון: META_ACCESS_TOKEN_<accountId> גובר על META_ACCESS_TOKEN. */
export function metaTokenFor(accountId) {
  return process.env['META_ACCESS_TOKEN_' + accountId] || process.env.META_ACCESS_TOKEN || ''
}
