/**
 * VITAS Reports — Google Ads Script (with PMax support)
 * Pulls daily metrics including Performance Max campaigns.
 *
 * Setup:
 *   1. Tools & Settings → Bulk Actions → Scripts → New Script
 *   2. Paste this entire file
 *   3. Click Authorize → Preview → check Logs (look for Response: 200)
 *   4. If 200 — set Frequency: Daily 02:00
 */

var CONFIG = {
  INGEST_URL: 'https://reports.vitas.co.il/api/google/script-ingest',
  SECRET: 'ebc09dbcaeb232287e82514184698e2928b05a15e1b5802a',
  PERIOD: 'LAST_MONTH',
};

function main() {
  var dateRange = CONFIG.PERIOD;
  var datesIso = computeIsoDates(dateRange);
  Logger.log('Date range: ' + dateRange + ' (' + datesIso.since + ' to ' + datesIso.until + ')');

  var customerId = AdsApp.currentAccount().getCustomerId();
  Logger.log('Customer ID: ' + customerId);

  // 1) Standard campaigns (Search, Display, Video, etc — NOT PMax)
  var standardCampaigns = collectStandardCampaigns(dateRange);
  Logger.log('Standard campaigns with spend: ' + standardCampaigns.length);

  // 2) Performance Max campaigns (separate API)
  var pmaxCampaigns = collectPMaxCampaigns(dateRange);
  Logger.log('PMax campaigns with spend: ' + pmaxCampaigns.length);

  var campaigns = standardCampaigns.concat(pmaxCampaigns);
  Logger.log('Total campaigns: ' + campaigns.length);

  // 3) Asset groups (PMax — for the dashboard's Asset Groups section)
  var assetGroups = collectAssetGroups();
  Logger.log('Asset groups: ' + assetGroups.length);

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

function computeIsoDates(name) {
  var today = new Date();
  var fmt = function(d) {
    var m = String(d.getMonth() + 1); if (m.length < 2) m = '0' + m;
    var dd = String(d.getDate()); if (dd.length < 2) dd = '0' + dd;
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
  var s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  var e = new Date(today.getFullYear(), today.getMonth(), 0);
  return { since: fmt(s), until: fmt(e) };
}

function collectStandardCampaigns(dateRange) {
  var rows = [];
  var iter;
  try { iter = AdsApp.campaigns().forDateRange(dateRange).get(); }
  catch (e) { Logger.log('Standard campaigns query failed: ' + e); return rows; }

  while (iter.hasNext()) {
    var camp = iter.next();
    var stats = camp.getStatsFor(dateRange);
    if (stats.getCost() <= 0) continue;
    rows.push({
      name: camp.getName(),
      id: camp.getId(),
      type: tryGet(function(){ return camp.getAdvertisingChannelType(); }, ''),
      status: camp.isEnabled() ? 'ENABLED' : (camp.isPaused() ? 'PAUSED' : 'OTHER'),
      spend: stats.getCost(),
      impressions: stats.getImpressions(),
      clicks: stats.getClicks(),
      conversions: stats.getConversions(),
      ad_groups: collectAdGroupsForCampaign(camp, dateRange),
    });
  }
  return rows;
}

function collectAdGroupsForCampaign(camp, dateRange) {
  var ags = [];
  try {
    var iter = camp.adGroups().forDateRange(dateRange).get();
    while (iter.hasNext()) {
      var ag = iter.next();
      var s = ag.getStatsFor(dateRange);
      var ads = [];
      try {
        var adIter = ag.ads().forDateRange(dateRange).get();
        while (adIter.hasNext()) {
          var ad = adIter.next();
          var as = ad.getStatsFor(dateRange);
          ads.push({
            name: tryGet(function(){ return ad.getName(); }, '') || ('Ad ' + ad.getId()),
            id: ad.getId(),
            headline: tryGet(function(){ return ad.getHeadline(); }, ''),
            text: tryGet(function(){ return ad.getDescription1() || ad.getDescription(); }, ''),
            spend: as.getCost(), impressions: as.getImpressions(), clicks: as.getClicks(), conversions: as.getConversions(),
          });
        }
      } catch (e) {}
      ags.push({
        name: ag.getName(), id: ag.getId(),
        spend: s.getCost(), impressions: s.getImpressions(), clicks: s.getClicks(), conversions: s.getConversions(),
        ads: ads,
      });
    }
  } catch (e) { Logger.log('Ad-groups query failed for camp=' + camp.getName() + ': ' + e); }
  return ags;
}

function collectPMaxCampaigns(dateRange) {
  var rows = [];
  if (typeof AdsApp.performanceMaxCampaigns !== 'function') {
    Logger.log('performanceMaxCampaigns not supported in this script version');
    return rows;
  }
  var iter;
  try { iter = AdsApp.performanceMaxCampaigns().forDateRange(dateRange).get(); }
  catch (e) {
    // Some script versions don't support forDateRange on PMax — fallback
    try { iter = AdsApp.performanceMaxCampaigns().get(); }
    catch (e2) { Logger.log('PMax query failed: ' + e2); return rows; }
  }

  while (iter.hasNext()) {
    var camp = iter.next();
    var stats;
    try { stats = camp.getStatsFor(dateRange); }
    catch (e) { Logger.log('Stats failed for PMax camp=' + camp.getName() + ': ' + e); continue; }
    if (stats.getCost() <= 0) continue;

    // PMax exposes stats only at campaign level (not per asset group).
    // Push a single synthetic ad-group with the full campaign stats so the
    // endpoint still produces a row.
    var syntheticAg = {
      name: camp.getName() + ' (PMax)',
      id: camp.getId(),
      spend: stats.getCost(),
      impressions: stats.getImpressions(),
      clicks: stats.getClicks(),
      conversions: stats.getConversions(),
      ads: [{
        name: camp.getName() + ' (PMax)',
        id: camp.getId(),
        spend: stats.getCost(),
        impressions: stats.getImpressions(),
        clicks: stats.getClicks(),
        conversions: stats.getConversions(),
      }],
    };

    rows.push({
      name: camp.getName(),
      id: camp.getId(),
      type: 'PERFORMANCE_MAX',
      status: tryGet(function(){ return camp.isEnabled() ? 'ENABLED' : (camp.isPaused() ? 'PAUSED' : 'OTHER'); }, 'OTHER'),
      spend: stats.getCost(),
      impressions: stats.getImpressions(),
      clicks: stats.getClicks(),
      conversions: stats.getConversions(),
      ad_groups: [syntheticAg],
    });
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
      } catch (e) { Logger.log('Asset groups failed for camp=' + camp.getName() + ': ' + e); }
    }
  } catch (e) { Logger.log('PMax campaigns failed: ' + e); }
  return groups;
}

function tryGet(fn, def) {
  try { return fn(); } catch (e) { return def; }
}
