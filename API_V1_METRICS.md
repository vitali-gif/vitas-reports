# vitas-reports — Read-only Metrics API (v1)

Read-only feed for the campaign-management Claude sessions (HI PARK / ONCE / REHAVIA).
Serves the **CRM-authoritative** funnel that the Graph/Google-Ads APIs don't have —
most importantly **`cost_per_meeting_completed`**.

## Endpoint
```
GET https://reports.vitas.co.il/api/v1/clients/{client_slug}/metrics
      ?project=hi-park
      &from=2026-08-17&to=2026-08-23
      &granularity=campaign|adset|ad     (default: ad)
      &platform=meta|google|all          (default: all)
      &refresh=1                          (optional: pull the period live if not yet cached)
Authorization: Bearer <READ_TOKEN>
```

* **HTTPS only.** Bearer token required. The token is **read-only** — no admin, no `/admin`, no writes, no PII.
* Each token is scoped to one `client_slug`; a token for `sbaruch` cannot read another client.
* Tokens are revocable one-by-one (see below) without affecting the others.

## Valid values
| param | values |
|---|---|
| `client_slug` | `sbaruch` |
| `project` | `hi-park`, `once`, `rehavia` |
| `granularity` | `campaign`, `adset`, `ad` |
| `platform` | `meta`, `google`, `all` |

`from`/`to` are `YYYY-MM-DD` (inclusive). Dates/timestamps are Asia/Jerusalem; currency ILS.

## Data model notes
* **Core metrics** are per campaign→adset→ad. Ad-platform rows (spend/impressions/clicks) are
  joined to CRM outcomes (leads/meetings/registrations/contracts) **by normalized ad name**.
  Untagged CRM leads roll into a row with `ad: null`.
* **`cost_per_meeting_completed = spend / meetings_completed`** — the headline metric.
* **Segments** (objections, cities, hours, day-of-week, response-time, housing/property type,
  age/gender, crm_sources) are at the **client/period** level.
* Numbers are numbers; **`null` (not `0`) means "no data"**. Per-ad registration/contract **value**
  is not available (Meta/CRM don't carry it per-ad) → `value: null`; see `totals` for period values.
* Privacy: aggregates only. No names, phones, or emails. Locations are **city**, never address.

## Errors
`401` missing/invalid/revoked token · `403` token not scoped to this client ·
`404` unknown client/project, or `period_not_cached` (returns `available_periods`; retry with `&refresh=1`) ·
`400` bad params.

## Example
```
curl -s 'https://reports.vitas.co.il/api/v1/clients/sbaruch/metrics?project=hi-park&from=2026-08-09&to=2026-08-16&granularity=ad&platform=meta' \
  -H 'Authorization: Bearer vitas_xxx'
```
```json
{
  "meta": {
    "client_slug": "sbaruch", "client": "ש.ברוך", "project": "hi-park",
    "from": "2026-08-09", "to": "2026-08-16", "granularity": "ad", "platform": "meta",
    "timezone": "Asia/Jerusalem", "currency": "ILS",
    "generated_at": "2026-08-16T12:00:00.000Z", "schema_version": 24,
    "notes": "Aggregates only, no PII. Per-ad registration/contract VALUE is unavailable (see totals). Ad join is by normalized ad name; untagged CRM leads roll into a null-ad row."
  },
  "totals": {
    "leads": 65, "relevant_leads": 27,
    "meetings_scheduled": 2, "meetings_completed": 2,
    "registrations": 0, "registrations_value": null,
    "contracts": 1, "contracts_value": 1885000,
    "meeting_completion_rate": 3.08
  },
  "metrics": [
    {
      "platform": "meta", "campaign": "Hi Park-Scaling-7/2026-LeadG",
      "adset": "תחומי בעניין (הייטקיסטים) | 30+ | מגדל העמק והסביבה",
      "ad": "AD 2 - זה לא בשבילכם",
      "spend": 830.15, "impressions": 41230, "clicks": 611,
      "leads": 2, "platform_leads": 3, "cpl": 415.08,
      "meetings_scheduled": 1, "meetings_completed": 0,
      "cost_per_meeting_completed": null,
      "registrations": { "count": null, "value": null },
      "contracts": { "count": null, "value": null },
      "cost_per_contract": null
    }
  ],
  "segments": {
    "objections": { "יקר מדי": 12, "אין במלאי": 7, "כושר החזר": 5 },
    "cities": { "מגדל העמק": 18, "עפולה": 9, "נצרת עילית": 6 },
    "housing_status": { "רוכש עבור הילדים": 8, "משפר דיור": 6 },
    "property_type": { "3 חדרים": 14, "4 חדרים": 11, "5 חדרים": 7 },
    "lead_hours": [ { "hour": 9, "count": 5 }, { "hour": 20, "count": 8 } ],
    "meeting_hours": [ { "hour": 17, "count": 3 } ],
    "day_of_week": { "0": 12, "1": 9, "2": 14 },
    "response_time": { "avg_minutes": 42.5, "total_leads": 65, "buckets": { "0-15m": 30, "15m-1h": 12 } },
    "age_breakdown": { "25-34": 16, "35-44": 21, "45-54": 12 },
    "gender_breakdown": { "male": 30, "female": 20 },
    "crm_sources": [
      { "source": "hi park | הטבה למשרתי צהל | פייסבוק", "leads": 27, "relevant": 13,
        "meetings_scheduled": 1, "meetings_completed": 0,
        "registrations": 0, "registrations_value": null, "contracts": 0, "contracts_value": null }
    ],
    "top_ads": [ "... same shape as metrics[], top 10 by spend ..." ]
  }
}
```

## Join model & attribution (v1.1)
* **Meta** rows are joined by numeric **`ad_id` / `adset_id` / `campaign_id`** (from BMBY `_cf` `מזהה מודעה/סדרה/קמפיין`, live from ~2026-08-09), matched against the Meta report. If a lead has no id, it falls back to **normalized ad name** (as before). Same-name creatives in different ads now separate correctly by `ad_id`.
* **Google** is name-based: `gclid` is stored on the lead but a raw gclid cannot be mapped to a campaign/asset-group without Google click data, so no id-join yet.
* Each row includes:
  * `ad_id` / `adset_id` / `campaign_id` — the numeric ids (null if name-only).
  * **`attribution_rate`** — % of the row's leads that carried a real `ad_id` (id-based). Low value ⇒ CPL/cost figures lean on name-matching and are less certain.
  * `join_method` — `"id"` (all leads id-matched), `"mixed"`, or `"name"`.

## `relevant_leads`
The BMBY client-level **`relevant`** flag (1/0), set by the sales rep during qualification —
i.e. leads that are *not* spam / duplicate / wrong-number / out-of-scope. Often a better
denominator than raw `leads` for judging real demand.

## Revoking / issuing tokens
Revoke one session (others keep working):
```sql
update api_tokens set revoked = true where label = 'campaign-session-once';
```
Issue a new token (store only its hash):
```sql
insert into api_tokens (token_hash, client_slug, label)
values (encode(digest('<PLAINTEXT_TOKEN>','sha256'),'hex'), 'sbaruch', 'campaign-session-x');
```
