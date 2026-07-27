# פרויקט דמו — `scripts/demo/`

תשתית ייצור הדאטהסט הקפוא של פרויקט הדמו **"אופק ים" / נוף אדמה בע״מ**,
המשמש להצגת הדשבורד ללקוחות פוטנציאליים ללא חשיפת נתוני לקוח אמיתי.

מסמך האפיון המלא: `C:\dev\reports dashboard\אפיון_פרויקט_דמו.md`

---

## העיקרון

התהליך **אינו** "לוקח נתון אמיתי ומחליף בו שמות" — גישה כזו משאירה תמיד סיכון
ששדה אחד נשכח (וב-summary של BMBY יש 19 שדות שמכילים מידע מזהה, כולל מספרי
טלפון ותיאורי פגישה חופשיים).

במקום זה:

```
ONCE אמיתי  →  extract-profile  →  profile.mjs      (מספרים ויחסים בלבד)
                                        +
                                   dictionaries.mjs  (זהויות בדויות)
                                        ↓
                                   synthesize        (רוסטר לידים סינתטי)
                                        ↓
                                   lib/demo-dataset.js
```

`profile.mjs` מכיל **אך ורק מספרים**. אין בו ולו מחרוזת אחת שמקורה בנתון
אמיתי — שמות מקורות עוברים מיפוי, ערים והתנגדויות מומרות למשקלים לפי דירוג,
ושמות לידים/טלפונים/תיאורי פגישות לא נקראים בכלל.

כל אילוצי השלמות (כרטיס KPI ⟷ מודאל שמות, Σ שורות ⟷ סכום, וכו') מתקיימים
**בבנייה**: הכל נגזר מרוסטר לידים אחד, בדיוק כמו ש-`app/api/bmby/fetch`
גוזר מהנתון האמיתי.

---

## הקבצים

| קובץ | תפקיד |
|---|---|
| `dictionaries.mjs` | מאגרי הזהויות הבדויות: שמות, ערים, התנגדויות, קמפיינים, תיאורי פגישות |
| `profile.mjs` | **המקור היחיד לכל מספר בדמו.** לכוונון הנרטיב — לערוך כאן ולבנות מחדש |
| `synthesize.mjs` | מנוע הסינתזה: פרופיל → 9 רשומות `reports` במבנה v13 |
| `build-demo-dataset.mjs` | מריץ סינתזה וכותב `lib/demo-dataset.js` |
| `verify-dataset.mjs` | סורק דליפות + 11 אילוצי שלמות. **חובה להריץ לפני seed** |
| `preview-recommendations.mjs` | מריץ את מנוע ההמלצות האמיתי על הדמו — כמה המלצות נדלקות |
| `extract-profile.mjs` | חילוץ הפרופיל מ-ONCE האמיתי (דורש service_role) |
| `make-creatives.mjs` | מייצר 6 קריאייטיבים SVG ל-`public/demo/` |
| `test-seed-shift.mjs` | מדמה 24 חודשי seed — מוודא שהדמו לא נשבר ושהמספרים לא זזים |
| `qa-screenshots.mjs` | QA ויזואלי: כל טאב × 3 תקופות × דסקטופ/מובייל |
| `PHASE_B_PATCHES.md` | השינויים בקבצים המשותפים — מוכנים, **לא הוחלו** |

---

## שימוש

```bash
# בנייה מלאה
node scripts/demo/make-creatives.mjs
node scripts/demo/build-demo-dataset.mjs

# ארבע הבדיקות — כולן חייבות לעבור
node scripts/demo/verify-dataset.mjs           # דליפות + אילוצי שלמות
node scripts/demo/test-seed-shift.mjs          # 24 חודשי seed קדימה
node scripts/demo/preview-recommendations.mjs  # ≥15 המלצות = טאב מלא

# QA ויזואלי (דורש next dev על פורט 3300)
npx next dev -p 3300 &
node scripts/demo/qa-screenshots.mjs           # → qa-screenshots/REPORT.md

# רענון הפרופיל מהנתון האמיתי (פעם אחת, מקומית)
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
node scripts/demo/extract-profile.mjs > scripts/demo/profile.mjs.new
# לבדוק את הפלט, ואז:  mv scripts/demo/profile.mjs.new scripts/demo/profile.mjs
```

**לכוונון המספרים** אין צורך לגעת בקוד — רק ב-`profile.mjs`. ליד כל משקל
רגיש יש הערה שמסבירה איזו המלצה הוא מפעיל ומה הסף.

---

## מצב נוכחי

✅ **שלב א׳ + ה-seeder הושלמו** — כל הבדיקות עוברות.

| בדיקה | תוצאה |
|---|---|
| דליפות | 0 |
| אילוצי שלמות | 11/11 |
| סימולציית 24 חודשי seed | 24/24 |
| המלצות חכמות | 25/27 (8-9 בכל תקופה) |
| QA ויזואלי | 62 צילומים · 0 אזהרות |
| קריאייטיבים | 6 SVG מקומיים (1080×1080) |

⏸️ **הנותר ממתין** לסיום השדרוג בסשן המקביל (הוא משנה את מבנה `summary`).

---

## מה נותר

1. **רענון הפרופיל** — `extract-profile.mjs` מול ONCE האמיתי (כרגע
   `_source: 'PLACEHOLDER'`). דורש `SUPABASE_SERVICE_ROLE_KEY`.
2. **התאמה לסכימה החדשה** — אם השדרוג הוסיף שדות ל-`summary`, להוסיף אותם
   ב-`synthesize.mjs` ולעדכן `CRM_SCHEMA_VERSION`.
3. ~~שכתוב `app/api/demo/route.js`~~ — ✅ נעשה. `POST {action:'seed'}` כותב
   את `DEMO_DATASET` תחת מפתחות התקופה של **היום**, עם הזזת תאריכים per-period.
4. **השינויים בקבצים המשותפים** — כתובים ומוכנים ב-`PHASE_B_PATCHES.md`,
   ממתינים לסיום השדרוג. **לא הוחלו.**
5. **תזמון ה-seed** — job יומי ב-GitHub Actions (נוסח מוכן ב-`PHASE_B_PATCHES.md` §6).
6. ~~QA ויזואלי~~ — ✅ נעשה אוטומטית, ראה `qa-screenshots/REPORT.md`.

---

## מה גילה ה-QA הוויזואלי

| ממצא | סטטוס |
|---|---|
| הכותרת מציגה "קבוצת אורבן / מטרופוליס" והסיידבר "נוף אדמה / אופק ים" | תיקון מוכן — §2 ב-PHASE_B_PATCHES |
| כרטיסי "המודעות המובילות" הציגו 0 לידים ו-₪0 | ✅ תוקן — `activeAds` דורש `name` + `metrics` |
| קריאייטיבים בפורמט רחב התקבלו עם פסים שחורים | ✅ תוקן — 1080×1080 |
| זמן מענה ממוצע נראה גבוה מדי | ✅ תוקן — קיצור הזנב הארוך |
| `Invalid scale configuration for scale: indexAxis` | באג ייצור — §5 ב-PHASE_B_PATCHES |
| Google PMax / Google Search לא מופיעים | התנהגות קיימת, לא ספציפי לדמו |

**על טאבי Google PMax/Search:** הם מותנים ב-`source === 'google_pmax'` /
`'google_search'`, ששום route לא כותב — `google/fetch` כותב `'google'` בלבד.
כלומר הם לא מופיעים גם ללקוחות אמיתיים. הדמו תואם לייצור.

---

## ⚠️ באג שהתגלה בקוד הייצור (לא בדמו)

`lib/recommendations.js` › `buildGeoWasteRec` (המלצת "עיר ששורפת תקציב")
מחפש ב-`crmRepRows` את השדות `scheduledAt` / `meetingScheduled` / `scheduled`:

```js
if (r.scheduledAt || r.meetingScheduled || r.scheduled === true) byCity[c].meetings++
```

אבל `app/api/bmby/fetch/route.js` (~L695) בונה `crmRepRows` עם ארבעה שדות בלבד:
`{ address, objections, lastMeeting, hasContract }`.

**אף אחד משלושת השדות לא קיים** → `meetings` תמיד 0 לכל עיר → `avgConv === 0`
→ `return null`. כלומר ההמלצה הזו **מעולם לא נדלקה לאף לקוח**, לא רק בדמו.

**התיקון:** להוסיף `scheduled` ל-`crmRepRows` ב-`bmby/fetch` ולהעלות את
`CRM_SCHEMA_VERSION`. השדרוג בסשן המקביל ממילא מעלה את הסכימה — זה המקום
הטבעי לצרף את התיקון.

בדמו השדה כבר נפלט, ולכן ההמלצה עובדת שם.
