/**
 * VITAS Reports — Google Ads Script
 * Pulls daily metrics from a Google Ads account and POSTs them to the dashboard.
 *
 * Setup:
 *   1. Tools & Settings → Bulk Actions → Scripts → New Script
 *   2. Paste this entire file
 *   3. Update SECRET below if needed
 *   4. Click Authorize → Preview → check Logs
 *   5. If response is 200, set Frequency: Daily 02:00
 */

var CONFIG = {
  INGEST_URL: 'https://reports.vitas.co.il/api/google/script-ingest',
  SECRET: 'ebc09dbcaeb232287e82514184698e2928b05a15e1b5802a',
  PERIOD: 'LAST_MONTH',  // LAST_MONTH | THIS_MONTH | LAST_7_DAYS | LAST_30_DAYS
};

function main() {
  var dateRange = CONFIG.PERIOD;
  var datesIso = computeIsoDates(dateRange);
  Logger.log('Date range: ' + dateRange + ' (' + datesIso.since + ' to ' + datesIso.until + ')');

  var customerId = AdsApp.currentAccount().getCustomerId();
  Logger.log('Customer ID: ' + customerId);

  var campaigns = collectCampaigns(dateRange);
  Logger.log('Collected ' + campaigns.length + ' campaigns with spend');

  var assetGroups = collectAssetGroups();
  Logger.log('Collected ' + assetGroups.length + ' asset groups');

  var payload = {
    customer_id: customerId,
    period: { since: datesIso.since, until: datesIso.until },
    campaigns: campaigns,
    asset_groups: assetGroups,
    timestamp: new Date().toISOString(),
  };

  Logger.log('Posting to ' + CONFIG.INGEST_URL);
  var resp = UrlFetchApp.fetch(CONFIG.INGEST_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-script-secret': CONFIG.SECRET },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  Logger.log('Response: ' + resp.getResponseCode());
  Logger.log('Body: ' + resp.getContentText().substring(0, 800));
}

// Convert built-in range names to ISO date strings (for our endpoint, not Google's)
function computeIsoDates(name) {
  var today = new Date();
  var fmt = function(d) {
    var m = String(d.getMonth() + 1);
    if (m.length < 2) m = '0' + m;
    var dd = String(d.getDate());
    if (dd.length < 2) dd = '0' + dd;
    return d.getFullYear() + '-' + m + '-' + dd;
  };
  if (name === 'THIS_MONTH') {
    var s = new Date(today.getFullYear(), today.getMonth(), 1);
    var e = new Date(today); e.setDate(e.getDate() - 1);
    return { since: fmt(s), until: fmt(e) };
  }
  if (name === 'LAST_7_DAYS') {
    var e = new Date(today); e.setDate(e.getDate() - 1);
    var s = new Date(today); s.setDate(s.getDate() - 7);
    return { since: fmt(s), until: fmt(e) };
  }
  if (name === 'LAST_30_DAYS') {
    var e = new Date(today); e.setDate(e.getDate() - 1);
    var s = new Date(today); s.setDate(s.getDate() - 30);
    return { since: fmt(s), until: fmt(e) };
  }
  // LAST_MONTH (default)
  var s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  var e = new Date(today.getFullYear(), today.getMonth(), 0);
  return { since: fmt(s), until: fmt(e) };
}

function collectCampaigns(dateRange) {
  var rows = [];
  // forDateRange accepts the built-in range name as a single string
  var iter;
  try {
    iter = AdsApp.campaigns().forDateRange(dateRange).get();
  } catch (e) {
    Logger.log('Campaigns query failed: ' + e);
    return rows;
  }

  while (iter.hasNext()) {
    var camp = iter.next();
    var stats = camp.getStatsFor(dateRange);
    if (stats.getCost() <= 0) continue;  // skip zero-cost campaigns

    var campObj = {
      name: camp.getName(),
      id: camp.getId(),
      status: camp.isEnabled() ? 'ENABLED' : (camp.isPaused() ? 'PAUSED' : 'OTHER'),
      type: tryGet(function(){ return camp.getAdvertisingChannelType(); }, ''),
      spend: stats.getCost(),
      impressions: stats.getImpressions(),
      clicks: stats.getClicks(),
      conversions: stats.getConversions(),
      ad_groups: [],
    };

    try {
      var agIter = camp.adGroups().forDateRange(dateRange).get();
      while (agIter.hasNext()) {
        var ag = agIter.next();
        var agStats = ag.getStatsFor(dateRange);
        var agObj = {
          name: ag.getName(),
          id: ag.getId(),
          spend: agStats.getCost(),
          impressions: agStats.getImpressions(),
          clicks: agStats.getClicks(),
          conversions: agStats.getConversions(),
          ads: [],
        };
        try {
          var adIter = ag.ads().forDateRange(dateRange).get();
          while (adIter.hasNext()) {
            var ad = adIter.next();
            var adStats = ad.getStatsFor(dateRange);
            agObj.ads.push({
              name: tryGet(function(){ return ad.getName(); }, '') || ('Ad ' + ad.getId()),
              id: ad.getId(),
              headline: tryGet(function(){ return ad.getHeadline(); }, ''),
              text: tryGet(function(){ return ad.getDescription1() || ad.getDescription(); }, ''),
              spend: adStats.getCost(),
              impressions: adStats.getImpressions(),
              clicks: adStats.getClicks(),
              conversions: adStats.getConversions(),
            });
          }
        } catch (e) { Logger.log('Ads iter failed for ag=' + ag.getName() + ': ' + e); }
        campObj.ad_groups.push(agObj);
      }
    } catch (e) { Logger.log('Ad-groups iter failed for camp=' + camp.getName() + ': ' + e); }

    rows.push(campObj);
  }
  return rows;
}

function collectAssetGroups() {
  var groups = [];
  try {
    if (typeof AdsApp.performanceMaxCampaigns !== 'function') return groups;
    var iter = AdsApp.performanceMaxCampaigns().get();
    while (iter.hasNext()) {
      var camp = iter.next();
      try {
        var agIter = camp.assetGroups().get();
        while (agIter.hasNext()) {
          var ag = agIter.next();
          groups.push({
            id: ag.getId(),
            name: ag.getName(),
            status: ag.isEnabled() ? 'ENABLED' : 'PAUSED',
            campaign: camp.getName(),
          });
        }
      } catch (e) { Logger.log('Asset groups iter failed for camp=' + camp.getName() + ': ' + e); }
    }
  } catch (e) {
    Logger.log('performanceMaxCampaigns failed: ' + e);
  }
  return groups;
}

function tryGet(fn, def) {
  try { return fn(); } catch (e) { return def; }
}
