# חיבורים — איך סשן מתחבר לפייסבוק, לגוגל ולדשבורד

> **המקום השמור:** הקובץ הזה, `docs/CONNECTIONS.md` במאגר vitas-reports.
> קישור: https://github.com/vitali-gif/vitas-reports/blob/main/docs/CONNECTIONS.md
>
> **הקובץ המרוכז של ויטלי, עם הערכים (7.10): `G:\האחסון שלי\API.txt`.** כל מפתח חדש — נוסף לשם.
>
> **עותק בדרייב (7.10):** "VITAS — מפת חיבורים ומפתחות (בלי ערכים).txt" בדרייב של vitalidisel@gmail.com —
> https://drive.google.com/file/d/1NyfHIdcMvlN9jq9L9yNmcaB6vo8N2qfn/view — גם הוא בלי ערכים. הערכים: מנהל הסיסמאות
> (פתק "VITAS — Google Ads API") ו-Vercel.
>
> **בקובץ הזה אין אף סוד, ואסור שיהיה.** הוא אומר *איפה* כל ערך נמצא ו*איך* מתחברים.
> הערכים עצמם — רק ב-Vercel, בהגדרות הסביבה של הסשן, ובמנהל הסיסמאות של ויטלי.
> לא מדביקים טוקן או סיסמה בצ'אט ולא דוחפים ל-GitHub: כל סשן קורא את המאגר, וההיסטוריה נשמרת לתמיד.

---

## 1. סשן לא מצליח להתחבר? שלוש בדיקות לפי הסדר

1. **האם הוא בכלל צריך להתחבר?** סשן שרק צריך *מספרים* (הוצאה, לידים, פגישות, עלות לפגישה)
   לא צריך פייסבוק או גוגל — הוא מקבל הכל מה-API של הדשבורד (סעיף 2). זה הנתיב המומלץ,
   כי שם גם נתוני ה-CRM, שאין בפייסבוק ובגוגל.
2. **רשת.** סשן בענן חוסם כתובות שלא ברשימה. אם השגיאה היא "host not allowed" / 403 מה-proxy:
   תפריט הסביבה בכותרת הסשן ← Edit ← Network access ← Custom, ולהוסיף את הדומיין (טבלה בסעיף 4).
   הוראות: https://code.claude.com/docs/en/cloud-environments#network-access
3. **מפתח.** אם השגיאה היא 401 / "invalid token": הסשן לא קיבל את המפתח, או שהמפתח פג.
   מפתחות נכנסים בהגדרות הסביבה (תפריט הסביבה ← Edit ← משתני סביבה), **לא בצ'אט**. סשן
   חדש קולט אותם; סשן פתוח — לא.

## 2. הדשבורד — `/api/v1` (המומלץ לסשני קמפיינים)

- כתובת: `https://reports.vitas.co.il/api/v1/clients/{client_slug}/metrics?project=…&from=…&to=…`
- כותרת: `Authorization: Bearer <טוקן>`
- **הטוקן:** טבלת `api_tokens` ב-Supabase. כל טוקן מוגבל ללקוח אחד (`client_slug`), לקריאה בלבד,
  ואפשר לבטל אותו לבד. הסוכן היומי משתמש בטוקן עם `client_slug = *`.
- **בסשן:** משתנה סביבה `VITAS_API_TOKEN` בהגדרות הסביבה. דומיין לרשת: `reports.vitas.co.il`.
- פירוט מלא: `API_V1_METRICS.md`.
- טוקן חדש ללקוח: לבקש מהסשן של הדשבורד ("תנפיק טוקן API ל-<לקוח>"). הוא יכין SQL שויטלי מריץ.

## 3. ישירות לפייסבוק ולגוגל (רק כשצריך לשנות קמפיינים, או נתון שאין בדשבורד)

### Meta (פייסבוק / אינסטגרם)
| מה | איפה |
|---|---|
| הדרך הקלה | המחבר **Meta Ads** של Claude: claude.ai ← Settings ← Connectors. מחובר פעם אחת לחשבון, עובד בכל סשן בלי מפתחות. |
| טוקן לשרת | `META_ACCESS_TOKEN` — טוקן של System User. מקור: Business Settings ← Users ← System users ← Generate token. https://business.facebook.com/settings/system-users |
| חשבונות מודעות | `META_AD_ACCOUNT_IDS` (רשימה), `META_AD_ACCOUNT_ID` (ברירת מחדל) |
| דומיין לרשת | `graph.facebook.com` |

### Google Ads
| מה | איפה |
|---|---|
| Developer token | `GOOGLE_ADS_DEVELOPER_TOKEN` — חשבון המנהל (MCC) ← Tools ← API Center. https://ads.google.com/aw/apicenter |
| OAuth | `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` — Google Cloud Console ← APIs & Services ← Credentials. https://console.cloud.google.com/apis/credentials |
| Refresh token | `GOOGLE_ADS_REFRESH_TOKEN` — נוצר פעם אחת ב-OAuth עם המשתמש שיש לו גישה ל-MCC |
| חשבון מנהל | `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (ה-MCC, בלי מקפים) |
| חשבונות | `GOOGLE_ADS_CUSTOMER_IDS` (רשימה), `GOOGLE_ADS_CUSTOMER_ID` |
| דומיינים לרשת | `googleads.googleapis.com`, `oauth2.googleapis.com` |

> סשן שצריך גוגל ישירות צריך את **ארבעת** הראשונים יחד. בלי `GOOGLE_ADS_LOGIN_CUSTOMER_ID` הקריאות
> לחשבונות שמתחת ל-MCC נכשלות ב-"USER_PERMISSION_DENIED" גם כשכל השאר נכון.

### כניסת לקוחות לדשבורד (Google / Microsoft)
| מה | איפה |
|---|---|
| Google — OAuth client | `838146922500-r3pto…` — **בחשבון הפרטי vitalidisel@gmail.com**, Google Cloud, בשם המבלבל "BCureLaser Google Ads" (משמש גם ל-Google Ads של בי-קיור — לא למחוק). Authorized JavaScript origins: `https://reports.vitas.co.il` (ל-GIS); redirect: ה-callback של Supabase. ב-Vercel: `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. |
| Google — הפרויקט `vitas-reports` | Client אחר (`504988157237-…`, "VITAS Reports Web") — **לא** זה של הכניסה. |
| Microsoft | Azure (Entra) "Default Directory" ← App registrations ← "Tovno by Vitas". סוד ב-Supabase, פג 10.2028. |

### Google Ads — שני ה-OAuth clients (7.10, מקור בלבול חוזר)
- `504988157237-…` "VITAS Reports Web" — פרויקט `vitas-reports` בארגון vitas.co.il. ה-`GOOGLE_ADS_CLIENT_ID` של הדשבורד: ב-Vercel הוא Sensitive (לא רואים ערך), אבל "Last used" ב-Google Cloud יומיומי (הקרון כל שעתיים) מול 21.9 של השני — 7.10.
- `838146922500-…` "BCureLaser Google Ads" — בחשבון הפרטי. זה של כניסת לקוחות עם Google (ראה למעלה).
- כלי חיצוני (למשל SerpBear) שמתחבר ל-Google Ads: אותם Client ID / Secret / Developer Token / Login Customer ID, ו-redirect URI של הכלי נוסף ל-Client שתואם ל-`GOOGLE_ADS_CLIENT_ID`. Secret שמוגדר Sensitive ב-Vercel — יוצרים חדש ב-Google Cloud (Add secret) בלי למחוק את הישן.

## 4. איפה כל ערך שמור

| איפה | מה יש שם | קישור |
|---|---|---|
| **Vercel** (המקור של הפרודקשן) | כל המשתנים שבטבלאות למעלה, ועוד CRM ו-Supabase | https://vercel.com/dashboard ← vitas-reports ← Settings ← Environment Variables |
| **הגדרות הסביבה של הסשן** | רק מה שאותו סשן צריך (למשל `VITAS_API_TOKEN`) | תפריט הסביבה בכותרת הסשן ← Edit |
| **GitHub Secrets** | `CRON_SECRET`, `QA_CLIENT_EMAIL`, `QA_CLIENT_PASSWORD`, `VERCEL_AUTOMATION_BYPASS_SECRET` (לקרונים ולבדיקות בלבד) | https://github.com/vitali-gif/vitas-reports/settings/secrets/actions |
| **מנהל הסיסמאות של ויטלי** | עותק של כל הנ"ל, כדי לא להיות תלוי ב-Vercel | — |

> משתני Secret ב-Vercel (`CRON_SECRET`, `RESEND_API_KEY`) לא נמשכים ב-`vercel env pull` — מופיעים כ-`[SENSITIVE]`.

### שאר המשתנים בפרויקט (לידיעה)
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (ציבורי, לא סוד ולא הרשאה), `SUPABASE_SERVICE_ROLE_KEY`
- CRM: `BMBY_LOGIN`, `BMBY_PASSWORD`, `BMBY_PROJECT_IDS` · `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` · `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_REFRESH_TOKEN` · `FIREBERRY_TOKEN`, `FIREBERRY_RATE_PER_MIN`
- תשתית: `CRON_SECRET`, `RESEND_API_KEY`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`

## 5. כשמחליפים מפתח
1. מחליפים ב-Vercel (ובמנהל הסיסמאות).
2. Redeploy בפרויקט ב-Vercel, אחרת הערך הישן נשאר בפריסה הפעילה.
3. בסשנים שמשתמשים בו — מעדכנים בהגדרות הסביבה ופותחים סשן חדש.
4. רושמים כאן את התאריך (בלי הערך).

| מפתח | הוחלף לאחרונה |
|---|---|
| `FIREBERRY_TOKEN` | — (נחשף בצ'אט 28.9; להחליף כשאלפא יסכימו) |
| סיסמת qa@vitas.co.il | — (ממתין להחלפה) |
