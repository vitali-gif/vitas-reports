/**
 * lib/ads/google-daily.js — עובדות יומיות מ-Google Ads ללקוח וטווח: אותן שאילתות כמו
 * ב-google/fetch (ad_group_ad + נפילה לרמת קמפיין ל-PMax), רק עם segments.date בבחירה
 * כדי לקבל שורה לכל יום. שלב 2 של docs/daily-ranges-plan.md.
 */
import { num, credsFor, getAccessToken, gaqlSearch, extractAdText } from './google-api.js'

/**
 * @returns {Promise<{rows: object[], diag: object}>} שורות בצורת ad_daily (source='google')
 */
export async function fetchGoogleDaily(customerId, since, until) {
  const creds = credsFor(customerId)
  const gopts = { login: creds.loginCustomerId, developerToken: creds.developerToken }
  const accessToken = await getAccessToken(creds)

  const adQuery = `
    SELECT
      segments.date,
      campaign.id, campaign.name, campaign.status,
      ad_group.id, ad_group.name, ad_group.status,
      ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status,
      ad_group_ad.ad.text_ad.description1,
      ad_group_ad.ad.expanded_text_ad.description,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.responsive_search_ad.headlines,
      metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${since}' AND '${until}'
  `
  const adRows = await gaqlSearch(accessToken, customerId, adQuery, gopts)
  const rows = adRows.map(r => ({
    source: 'google', account: customerId, day: r.segments?.date || '',
    campaign_id: r.campaign?.id ? String(r.campaign.id) : '', campaign: r.campaign?.name || '',
    adset_id: r.adGroup?.id ? String(r.adGroup.id) : '', adset: r.adGroup?.name || '',
    ad_id: r.adGroupAd?.ad?.id ? String(r.adGroupAd.ad.id) : '',
    ad: r.adGroupAd?.ad?.name || (r.adGroupAd?.ad?.id ? `Ad ${r.adGroupAd.ad.id}` : ''),
    age: '', gender: '',
    ad_text: extractAdText(r.adGroupAd?.ad),
    spend: num(r.metrics?.costMicros) / 1_000_000,
    impressions: num(r.metrics?.impressions), reach: 0,
    clicks: num(r.metrics?.clicks), leads: num(r.metrics?.conversions),
    campaign_status: r.campaign?.status || '', adset_status: r.adGroup?.status || '', ad_status: r.adGroupAd?.status || '',
  }))

  // Performance Max / Smart — אין שורות ad_group_ad. שורה אחת לקמפיין ליום, רק לימים
  // שבהם הקמפיין לא הופיע ברמת מודעה (אותו כלל כמו ב-google/fetch, אבל ליום).
  let campaignRows = 0
  try {
    const campQuery = `
      SELECT
        segments.date,
        campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
        metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
      FROM campaign
      WHERE segments.date BETWEEN '${since}' AND '${until}'
        AND campaign.status != 'REMOVED'
    `
    const seen = new Set(rows.map(r => r.day + '|' + r.campaign))
    for (const r of await gaqlSearch(accessToken, customerId, campQuery, gopts)) {
      const cn = r.campaign?.name || '', day = r.segments?.date || ''
      if (!cn || !day || seen.has(day + '|' + cn)) continue
      const channelType = r.campaign?.advertisingChannelType || ''
      rows.push({
        source: 'google', account: customerId, day,
        campaign_id: r.campaign?.id ? String(r.campaign.id) : '', campaign: cn,
        adset_id: '', adset: channelType || '(campaign-level)',
        ad_id: '', ad: cn, age: '', gender: '', ad_text: '',
        spend: num(r.metrics?.costMicros) / 1_000_000,
        impressions: num(r.metrics?.impressions), reach: 0,
        clicks: num(r.metrics?.clicks), leads: num(r.metrics?.conversions),
        campaign_status: r.campaign?.status || '', adset_status: '', ad_status: '',
      })
      campaignRows++
    }
  } catch (err) {
    // לא קריטי — כמו ב-google/fetch
    return { rows, diag: { customer: customerId, since, until, adRows: adRows.length, campaignRows, campaignQueryError: String(err?.message || err) } }
  }
  return { rows, diag: { customer: customerId, since, until, adRows: adRows.length, campaignRows } }
}
