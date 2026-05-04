# Google Ads Script - Installation Guide

## What this script does
Pulls campaign / ad-group / ad metrics from a Google Ads account and posts them
to the VITAS Reports dashboard at https://reports.vitas.co.il. Runs daily.

This is a workaround used while the Google Ads API Basic Access application
is pending review.

## Prerequisites
- Access to the Google Ads account (e.g., the ש.ברוך account)
- The shared secret value (sent separately by Vitali — must match the
  `GOOGLE_SCRIPT_SECRET` env var on Vercel)

## Installation steps

### 1. Open the Scripts editor
1. Sign in to https://ads.google.com
2. Pick the customer account (e.g., ש.ברוך — 863-912-0262)
3. Top menu: **Tools & Settings** → under **Bulk Actions**: **Scripts**
4. Click the blue **+** button → **New script**

### 2. Paste and configure
1. Delete the default code in the editor
2. Open `scripts/google-ads-script.js` from this repo and copy the entire file
3. Paste into the script editor
4. Find the `CONFIG` block at the top (lines 24–28) and update:
   ```
   SECRET: 'CHANGE_ME_TO_YOUR_GOOGLE_SCRIPT_SECRET'
   ```
   Replace with the actual secret you received

5. Optional: change `PERIOD: 'LAST_MONTH'` to one of:
   - `'THIS_MONTH'` — current month so far
   - `'LAST_7_DAYS'` — yesterday minus 7
   - `'LAST_30_DAYS'`

### 3. Authorize
1. Click **Authorize** at the top of the editor
2. Google will ask for permissions — click **Allow**
3. (One-time only)

### 4. Test run
1. Click **Preview** (or **Run**, if Preview isn't available)
2. Wait ~30-60 seconds
3. Click the **Logs** tab — should show:
   ```
   Period: 2026-04-01 to 2026-04-30
   Customer ID: 863-912-0262
   Posting N campaigns + M asset groups
   Response: 200 {"ok":true,...}
   ```
4. If the response code is 401: secret is wrong
5. If it's 200 but with empty projects: campaign names don't match project names
   in the dashboard — contact Vitali

### 5. Schedule daily
1. Click **Save**
2. From the script list, find your script and click the menu (⋮)
3. **Edit frequency** → **Daily** at **02:00**
4. Save

## Verification
After the first scheduled run, log into https://reports.vitas.co.il/admin and
check that Google data appears in the dashboard.

## Troubleshooting
- **401 Unauthorized**: Check the SECRET in CONFIG matches Vercel's
  GOOGLE_SCRIPT_SECRET env var
- **No campaigns found**: Make sure you're in the correct customer account
  (not the MCC manager)
- **Empty response**: campaigns must have spend > 0 in the date range
- **Email from Google about script errors**: Logger.log output is sent to the
  account owner. Check the email for stack traces.
