/**
 * VITAS Reports — Google Ads Script (with PMax + asset-group metrics + previews)
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

  var standardCampaigns = collectStandardCampaigns(dateRange);
  Logger.log('Standard campaigns with spend: ' + standardCampaigns.length);

  var pmaxCampaigns = collectPMaxCampaigns(dateRange);
  Logger.log('PMax campaigns with spend: ' + pmaxCampaigns.length);

  var campaigns = standardCampaigns.concat(pmaxCampaigns);
  Logger.log('Total campaigns: ' + campaigns.length);

  // Asset groups WITH metrics + assets (via GAQL)
  var assetGroups = collectAssetGroupsWithDetails(datesIso.since, datesIso.until);
  Logger.log('Asset groups with details: ' + assetGroups.length);

  var payload = {
    customer_id: customerId,
    period: { since: datesIso.since, until: datesIso.until },
    campaigns: campaigns,
    asset_groups: assetGroups,
    timestamp: new Date().toISOString(),
  };

  Logger.log('Posting to ' + CONFIG.INGEST_URL);
  var resp = UrlFetchApp.fetch(CONFIG.INGEST_URL, {
    method: 'post', contentType: 'application/json',
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
  if (name === 'THIS_MONTH') { var s = new Date(today.getFullYear(), today.getMonth(), 1); var e = new Date(today); e.setDate(e.getDate() - 1); return { since: fmt(s), until: fmt(e) }; }
  if (name === 'LAST_7_DAYS') { var e = new Date(today); e.setDate(e.getDate() - 1); var s = new Date(today); s.setDate(s.getDate() - 7); return { since: fmt(s), until: fmt(e) }; }
  if (name === 'LAST_30_DAYS') { var e = new Date(today); e.setDate(e.getDate() - 1); var s = new Date(today); s.setDate(s.getDate() - 30); return { since: fmt(s), until: fmt(e) }; }
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
      name: camp.getName(), id: camp.getId(),
      type: tryGet(function(){ return camp.getAdvertisingChannelType(); }, ''),
      status: camp.isEnabled() ? 'ENABLED' : (camp.isPaused() ? 'PAUSED' : 'OTHER'),
      spend: stats.getCost(), impressions: stats.getImpressions(),
      clicks: stats.getClicks(), conversions: stats.getConversions(),
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
  } catch (e) {}
  return ags;
}

function collectPMaxCampaigns(dateRange) {
  var rows = [];
  if (typeof AdsApp.performanceMaxCampaigns !== 'function') return rows;
  var iter;
  try { iter = AdsApp.performanceMaxCampaigns().forDateRange(dateRange).get(); }
  catch (e) {
    try { iter = AdsApp.performanceMaxCampaigns().get(); }
    catch (e2) { Logger.log('PMax query failed: ' + e2); return rows; }
  }
  while (iter.hasNext()) {
    var camp = iter.next();
    var stats;
    try { stats = camp.getStatsFor(dateRange); }
    catch (e) { Logger.log('Stats failed for PMax camp=' + camp.getName() + ': ' + e); continue; }
    if (stats.getCost() <= 0) continue;
    var syntheticAg = {
      name: camp.getName() + ' (PMax)', id: camp.getId(),
      spend: stats.getCost(), impressions: stats.getImpressions(),
      clicks: stats.getClicks(), conversions: stats.getConversions(),
      ads: [{
        name: camp.getName() + ' (PMax)', id: camp.getId(),
        spend: stats.getCost(), impressions: stats.getImpressions(),
        clicks: stats.getClicks(), conversions: stats.getConversions(),
      }],
    };
    rows.push({
      name: camp.getName(), id: camp.getId(),
      type: 'PERFORMANCE_MAX',
      status: tryGet(function(){ return camp.isEnabled() ? 'ENABLED' : (camp.isPaused() ? 'PAUSED' : 'OTHER'); }, 'OTHER'),
      spend: stats.getCost(), impressions: stats.getImpressions(),
      clicks: stats.getClicks(), conversions: stats.getConversions(),
      ad_groups: [syntheticAg],
    });
  }
  return rows;
}

// =================== Asset Groups via GAQL ===================
// Pulls per-asset-group metrics AND attached assets (headlines, descriptions, images, videos)
function collectAssetGroupsWithDetails(since, until) {
  var byId = {};

  // 1) Metrics per asset group
  try {
    var q1 = "SELECT asset_group.id, asset_group.name, asset_group.status, " +
             "campaign.id, campaign.name, " +
             "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions " +
             "FROM asset_group " +
             "WHERE segments.date BETWEEN '" + since + "' AND '" + until + "'";
    var rep = AdsApp.report(q1);
    var rows = rep.rows();
    while (rows.hasNext()) {
      var r = rows.next();
      var id = r['asset_group.id'];
      if (!byId[id]) {
        byId[id] = {
          id: id,
          name: r['asset_group.name'] || '',
          status: r['asset_group.status'] || '',
          campaign_id: r['campaign.id'] || '',
          campaign: r['campaign.name'] || '',
          spend: 0, impressions: 0, clicks: 0, conversions: 0,
          assets: [],
        };
      }
      // metrics may be aggregated per row already (one row per asset group due to no segmentation)
      byId[id].spend += (parseInt(r['metrics.cost_micros'] || '0', 10)) / 1000000;
      byId[id].impressions += parseInt(r['metrics.impressions'] || '0', 10);
      byId[id].clicks += parseInt(r['metrics.clicks'] || '0', 10);
      byId[id].conversions += parseFloat(r['metrics.conversions'] || '0');
    }
    Logger.log('Asset group metrics rows: ' + Object.keys(byId).length);
  } catch (e) {
    Logger.log('asset_group metrics query failed: ' + e);
  }

  // 2) Attached assets (text + images + videos)
  try {
    var q2 = "SELECT asset_group.id, asset_group_asset.field_type, " +
             "asset.id, asset.type, asset.name, " +
             "asset.text_asset.text, " +
             "asset.image_asset.full_size.url, " +
             "asset.image_asset.full_size.width_pixels, " +
             "asset.image_asset.full_size.height_pixels, " +
             "asset.youtube_video_asset.youtube_video_id, " +
             "asset.youtube_video_asset.youtube_video_title " +
             "FROM asset_group_asset " +
             "WHERE asset_group_asset.status = 'ENABLED'";
    var rep2 = AdsApp.report(q2);
    var rows2 = rep2.rows();
    var count = 0;
    while (rows2.hasNext()) {
      var r = rows2.next();
      var agid = r['asset_group.id'];
      if (!byId[agid]) continue; // skip assets for groups we don't have metrics for
      byId[agid].assets.push({
        asset_id: r['asset.id'] || '',
        type: r['asset.type'] || '',
        field_type: r['asset_group_asset.field_type'] || '',
        name: r['asset.name'] || '',
        text: r['asset.text_asset.text'] || '',
        image_url: r['asset.image_asset.full_size.url'] || '',
        image_width: r['asset.image_asset.full_size.width_pixels'] || '',
        image_height: r['asset.image_asset.full_size.height_pixels'] || '',
        youtube_id: r['asset.youtube_video_asset.youtube_video_id'] || '',
        youtube_title: r['asset.youtube_video_asset.youtube_video_title'] || '',
      });
      count++;
    }
    Logger.log('Asset details rows: ' + count);
  } catch (e) {
    Logger.log('asset_group_asset query failed: ' + e);
  }

  // Return as array
  var arr = [];
  for (var k in byId) arr.push(byId[k]);
  return arr;
}

function tryGet(fn, def) {
  try { return fn(); } catch (e) { return def; }
}
