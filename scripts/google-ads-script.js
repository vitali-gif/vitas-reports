/**
 * VITAS Reports — Google Ads Script
 * 
 * Pastes into a Google Ads account at: Tools & Settings → Bulk Actions → Scripts → New Script.
 * Runs on Google's servers, pulls daily metrics, posts them to our dashboard.
 *
 * Setup:
 *   1. In Google Ads → Tools & Settings → Bulk Actions → Scripts → New Script
 *   2. Paste this entire file
 *   3. Set INGEST_URL and SECRET below
 *   4. Click "Authorize" (Google asks permission once)
 *   5. Click "Run" once to test → Check the logs
 *   6. If it worked, set "Frequency: Daily" → schedule for ~02:00
 *
 * What it does:
 *   - Pulls campaign / ad-group / ad metrics for the previous full calendar month
 *     (configurable via PERIOD below)
 *   - Pulls asset-group data for Performance Max campaigns
 *   - POSTs everything to our dashboard endpoint
 */

// ====== CONFIGURE ME ======
var CONFIG = {
  INGEST_URL: 'https://reports.vitas.co.il/api/google/script-ingest',
  SECRET: 'CHANGE_ME_TO_YOUR_GOOGLE_SCRIPT_SECRET',  // must match GOOGLE_SCRIPT_SECRET in Vercel env vars
  PERIOD: 'LAST_MONTH',                              // options: LAST_MONTH, THIS_MONTH, LAST_7_DAYS, LAST_30_DAYS
};

// ====== MAIN ======
function main() {
  var period = computePeriod(CONFIG.PERIOD);
  Logger.log('Period: ' + period.since + ' to ' + period.until);

  var customerId = AdsApp.currentAccount().getCustomerId();
  Logger.log('Customer ID: ' + customerId);

  var campaigns = collectCampaigns(period);
  var assetGroups = collectAssetGroups(period);

  var payload = {
    customer_id: customerId,
    period: { since: period.since, until: period.until },
    campaigns: campaigns,
    asset_groups: assetGroups,
    timestamp: new Date().toISOString(),
  };

  Logger.log('Posting ' + campaigns.length + ' campaigns + ' + assetGroups.length + ' asset groups');
  var resp = UrlFetchApp.fetch(CONFIG.INGEST_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-script-secret': CONFIG.SECRET },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  Logger.log('Response: ' + resp.getResponseCode() + ' ' + resp.getContentText().substring(0, 500));
}

// ====== PERIOD ======
function computePeriod(name) {
  var today = new Date();
  var fmt = function(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dd;
  };
  if (name === 'THIS_MONTH') {
    var start = new Date(today.getFullYear(), today.getMonth(), 1);
    var end = new Date(today); end.setDate(end.getDate() - 1);
    return { since: fmt(start), until: fmt(end) };
  }
  if (name === 'LAST_7_DAYS') {
    var end = new Date(today); end.setDate(end.getDate() - 1);
    var start = new Date(today); start.setDate(start.getDate() - 7);
    return { since: fmt(start), until: fmt(end) };
  }
  if (name === 'LAST_30_DAYS') {
    var end = new Date(today); end.setDate(end.getDate() - 1);
    var start = new Date(today); start.setDate(start.getDate() - 30);
    return { since: fmt(start), until: fmt(end) };
  }
  // LAST_MONTH (default)
  var start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  var end = new Date(today.getFullYear(), today.getMonth(), 0);
  return { since: fmt(start), until: fmt(end) };
}

// ====== CAMPAIGNS / AD GROUPS / ADS ======
function collectCampaigns(period) {
  var rows = [];
  var dateRange = period.since.replace(/-/g, '') + ',' + period.until.replace(/-/g, '');

  // Iterate ENABLED + PAUSED campaigns (we want to see all that ran in the period)
  var campIter = AdsApp.campaigns()
    .forDateRange(period.since, period.until)
    .withCondition("Cost > 0")
    .get();

  while (campIter.hasNext()) {
    var camp = campIter.next();
    var stats = camp.getStatsFor(period.since, period.until);

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

    // Ad groups under campaign
    var agIter = camp.adGroups().forDateRange(period.since, period.until).get();
    while (agIter.hasNext()) {
      var ag = agIter.next();
      var agStats = ag.getStatsFor(period.since, period.until);
      var agObj = {
        name: ag.getName(),
        id: ag.getId(),
        spend: agStats.getCost(),
        impressions: agStats.getImpressions(),
        clicks: agStats.getClicks(),
        conversions: agStats.getConversions(),
        ads: [],
      };

      // Ads under ad-group
      var adIter = ag.ads().forDateRange(period.since, period.until).get();
      while (adIter.hasNext()) {
        var ad = adIter.next();
        var adStats = ad.getStatsFor(period.since, period.until);
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
      campObj.ad_groups.push(agObj);
    }

    rows.push(campObj);
  }
  return rows;
}

// ====== ASSET GROUPS (Performance Max) ======
function collectAssetGroups(period) {
  var groups = [];
  try {
    // PMax campaigns expose asset groups via .assetGroups()
    var iter = AdsApp.performanceMaxCampaigns().get();
    while (iter.hasNext()) {
      var camp = iter.next();
      var agIter = camp.assetGroups().get();
      while (agIter.hasNext()) {
        var ag = agIter.next();
        groups.push({
          id: ag.getId(),
          name: ag.getName(),
          status: ag.isEnabled() ? 'ENABLED' : 'PAUSED',
          campaign: camp.getName(),
          // assets: omitted — would need a separate query, can be added later
        });
      }
    }
  } catch (e) {
    Logger.log('asset_groups failed: ' + e);
  }
  return groups;
}

// ====== HELPERS ======
function tryGet(fn, def) {
  try { return fn(); } catch (e) { return def; }
}
