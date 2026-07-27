# שלב ב׳ — שינויים בקבצים המשותפים

השינויים כאן **לא הוחלו**. הם ממתינים לסיום השדרוג המקביל, כי הם נוגעים
ב-`app/admin/page.js` — הקובץ שהשדרוג עובד עליו.

כל שינוי מובא כ-before/after מדויק במקום כ-diff, כי מספרי השורות בקובץ
יזוזו אחרי השדרוג. חפש את מחרוזת ה-before והחלף.

---

## 1. `app/admin/page.js` — חסימת auto-fetch בפרויקט דמו

**למה:** ה-useEffect של המשיכה האוטומטית לא יודע על `is_demo`. בכל טעינה של
הדמו הוא יזהה ש"חסרים נתונים" (למשל בטווח שלא נזרע), יפעיל
`triggerFetch` → Meta/Google/BMBY, ויציג באנר "🔄 מושך נתונים חיים…" באמצע
פגישת מכירה. שלוש הקריאות ייכשלו בשקט (אין מיפוי BMBY, אין קמפיין תואם),
אז אין נזק לנתונים — רק לרושם.

**איפה:** ה-useEffect שמתחיל ב-`// Auto-fetch any missing data sources` (היה ~L840).

**before**
```js
    if (isClientView && activePreset !== 'custom') return; // client: cron covers presets; only fetch for custom ranges
    if (!selectedMonth || !selectedProject) return;
    if (refreshing || refreshingCrm) return;
```

**after**
```js
    if (isClientView && activePreset !== 'custom') return; // client: cron covers presets; only fetch for custom ranges
    // פרויקט דמו: הנתונים קפואים ונזרעים ע"י /api/demo. אסור למשוך חי —
    // הקריאות ייכשלו בשקט אבל יציגו באנר "מושך נתונים" באמצע הדגמה.
    if (selectedProject?.is_demo) return;
    if (!selectedMonth || !selectedProject) return;
    if (refreshing || refreshingCrm) return;
```

---

## 2. `app/admin/page.js` — שם הדמו מה-DB במקום קבוע בקוד

**למה:** כרגע ה-TitleBar מציג `'קבוצת אורבן' / 'מטרופוליס'` — שמות מהניסיון
הקודם, מקודדים בקוד. הפרויקט בפועל נקרא "נוף אדמה בע״מ / אופק ים", כך
שהסיידבר והכותרת מציגים שני שמות שונים. אומת בצילום המסך
`qa-screenshots/desktop-current-הכל.png`.

**before** (~L95-96)
```js
export default function AdminPage({ isClientView = false, allowedProjectIds = null, initialClients = null, initialProjectId = null }) {
  const DEMO_CLIENT_NAME  = 'קבוצת אורבן'
  const DEMO_PROJECT_NAME = 'מטרופוליס'
```

**after**
```js
export default function AdminPage({ isClientView = false, allowedProjectIds = null, initialClients = null, initialProjectId = null }) {
  // שמות הדמו מגיעים מה-DB (הפרויקט/הלקוח שסומנו is_demo) ולא מקודדים בקוד,
  // כדי שהכותרת והסיידבר לא יציגו שני שמות שונים.
```

**ובהמשך** (~L4187-4188) — פשוט להשתמש בשמות האמיתיים:

**before**
```js
              client={isDemoProject ? DEMO_CLIENT_NAME : selectedClient?.name}
              project={isDemoProject ? DEMO_PROJECT_NAME : selectedProject?.name}
```

**after**
```js
              client={selectedClient?.name}
              project={selectedProject?.name}
```

---

## 3. `app/admin/page.js` — לא לטשטש קריאייטיבים מקומיים של הדמו

**למה:** ה-`blur(8px)` נועד להסתיר תמונות של לקוח אמיתי. הקריאייטיבים של
הדמו הם SVG סינתטיים ב-`/demo/` — טשטוש שלהם רק גורם לטאב להיראות שבור.
התנאי החדש שומר על ההגנה לכל תמונה שאינה מקומית.

**before** (~L3898)
```js
                  const demoBlur = isDemoProject ? {filter:'blur(8px)'} : undefined;
```

**after**
```js
                  // קריאייטיב מקומי של הדמו (/demo/...) מוצג חד; כל מקור חיצוני מטושטש.
                  const _isLocalDemoAsset = typeof previewImg === 'string' && previewImg.startsWith('/demo/');
                  const demoBlur = (isDemoProject && !_isLocalDemoAsset) ? {filter:'blur(8px)'} : undefined;
```

**ובאותו אופן** ב-~L2457 ו-~L2473 (תמונות ההמלצות):

**before**
```js
                          <img src={rec.assets.best.imageUrl} className="rec-ad-media" alt={rec.assets.best.adName} loading="lazy" style={isDemoProject ? {filter:'blur(8px)'} : undefined} />
```

**after**
```js
                          <img src={rec.assets.best.imageUrl} className="rec-ad-media" alt={rec.assets.best.adName} loading="lazy" style={(isDemoProject && !String(rec.assets.best.imageUrl || '').startsWith('/demo/')) ? {filter:'blur(8px)'} : undefined} />
```
(וזהה עבור `rec.assets.worst`)

---

## 4. `app/client/page.js` — העברת `is_demo` לכניסת לקוח

**למה:** `buildClients()` מקודד `is_demo: false`, ולכן באנר "מצב הדגמה"
והטשטוש **אינם פועלים** כשנכנסים דרך `/client`. כרגע הוחלט שהדמו מוצג רק
באדמין, אז זה לא חוסם — אבל זה באג אמיתי שכדאי לתקן בזמן שנוגעים בקובץ.

**before** (L22)
```js
    map.get(cName).projects.push({ id: a.project_id, name: a.projects?.name, is_demo: false });
```

**after**
```js
    map.get(cName).projects.push({ id: a.project_id, name: a.projects?.name, is_demo: !!a.projects?.is_demo });
```

> ⚠️ יש לוודא ש-`/api/client-access` אכן מחזיר `projects.is_demo` ב-select.
> אם לא — להוסיף אותו שם.

---

## 5. (נפרד) תיקון באג ייצור: `buildGeoWasteRec` לא נדלק לאף לקוח

זה **לא** חלק מפרויקט הדמו, אבל השדרוג המקביל ממילא מעלה את
`CRM_SCHEMA_VERSION` — וזה המקום הטבעי לצרף.

`lib/recommendations.js` › `buildGeoWasteRec` סופר פגישות לפי:
```js
if (r.scheduledAt || r.meetingScheduled || r.scheduled === true) byCity[c].meetings++
```
אבל `app/api/bmby/fetch/route.js` (~L695) בונה `crmRepRows` כך:
```js
      crmReportRows.push({
        address: city || address || '',
        objections: objection,
        lastMeeting,
        hasContract: contractClientSet.has(cid),
      })
```
אף אחד משלושת השדות לא קיים → `meetings` תמיד 0 → `avgConv === 0` →
`return null`. ההמלצה "עיר ששורפת תקציב" מעולם לא הוצגה לאף לקוח.

**התיקון** — להוסיף שדה אחד:
```js
      crmReportRows.push({
        address: city || address || '',
        objections: objection,
        lastMeeting,
        hasContract: contractClientSet.has(cid),
        scheduled: _lidScheduled(lid),   // ← buildGeoWasteRec מחפש את זה
      })
```
ולהעלות `CRM_SCHEMA_VERSION` (בשלושת המקומות: `admin/page.js` ×2 +
`bmby/fetch`).

> בדאטהסט של הדמו השדה כבר נפלט, ולכן ההמלצה עובדת שם.

---

## 6. תזמון ה-seed

`/api/demo` דורש `CRON_SECRET`. להוסיף ל-`.github/workflows/vitas-cron.yml`
job יומי:

```yaml
  demo-seed:
    runs-on: ubuntu-latest
    steps:
      - name: Seed demo project
        run: |
          curl -sS -X POST "https://reports.vitas.co.il/api/demo" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            -H "Content-Type: application/json" \
            -d '{"action":"seed"}' \
            --fail-with-body
```

**למה יומי ולא חודשי:** ה-seeder ממפה את תאריכי החודש הנוכחי לטווח
[1 בחודש .. היום]. הרצה חודשית בלבד הייתה מציגה, ב-20 בחודש, את כל 143
הלידים מרוכזים בתאריכי תחילת החודש. ההרצה זולה — 9 upserts.

בדיקה ידנית:
```bash
curl -X POST https://reports.vitas.co.il/api/demo \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H 'Content-Type: application/json' -d '{"action":"seed"}'

curl -s "https://reports.vitas.co.il/api/demo" -H "x-client-key: $ANON_KEY" | jq
```

---

## 7. עמוד ה-QA המקומי

`app/demo-preview/page.js` נוצר לצורך צילומי ה-QA (מרנדר את הדשבורד עם
הדאטהסט בלי DB ובלי התחברות). הוא מוגן ב-`NODE_ENV === 'production'`
ומחזיר `null` בפרודקשן.

**החלטה נדרשת:** להשאיר בריפו ככלי QA, או להסיר לפני מיזוג. אם משאירים —
כדאי לוודא שההגנה אכן מספיקה בעיניך.
