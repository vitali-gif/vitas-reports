# מפת התממשקויות לקלוד
נבדק מול המקורות המצוינים ב-19.09.2026. אין כאן חשבונות או credentials שנוסו. לפני implementation יש לאמת endpoint/scopes מול הגרסה המופעלת, סוג החשבון והמדיניות הארגונית. דרישות המוצר להלן הן החלטות תכנון; אינן הבטחה של ספק.

## הפרדה בין חיבורים
| שכבה | ספק | תפקיד |
|---|---|---|
| זהות | Google OIDC / Microsoft identity platform | כניסה ושיוך למשתמש VITAS |
| יומן | Google Calendar API / Microsoft Graph Calendar | אירוע, מוזמנים, עדכון וביטול |
| שיחת וידאו | Meet / Teams / Zoom | join URL ומזהה פגישה |
| חומרים | Meet API/Drive, Graph, Zoom cloud recordings | איתור תמלול/הקלטה קיימים ומורשים |
| תמלול עברית | ספק STT מאומת, מועמד: Azure Speech | תמלול אודיו כשאין תמלול מתאים |
| סיכום | ספק ה-LLM הקיים במאגר, אם יש | טיוטה מובנית מתוך התמלול |
| הודעות | שירות האימייל הקיים + הודעות בתוך האפליקציה | קישור לסיכום ותזכורות אחרי אישור |

אין צורך בהרשאת Gmail read/send רק כדי להיכנס או ליצור אירוע. הזמנות נשלחות באמצעות ספק היומן. שיתוף הסיכום דרך מערכת מייל של VITAS ולא התחזות לשולח דרך תיבת המארגן. אם אין mail service קיים, יש להגדיר אחד עם דומיין מאומת; עד אז כפתור השליחה מציג חסר, לא הצלחה מדומה.

## Google — זהות ויומן
השתמש ב-OAuth authorization code בצד שרת וב-OIDC לאימות, עם state/nonce לפי תשתית auth. בקש הרשאות יומן בעת חיבור יומן, לא מכל צופה בכניסה. refresh token מוצפן בצד שרת מאפשר המשכיות כשההרשאה בתוקף; invalid_grant מוביל לחיבור מחדש. אין שמירת סיסמה. [תיעוד Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)

לזהות: openid/email/profile בהתאם לתשתית הקיימת. scope לכתיבת אירועים מוצע calendar.events; אם מאפשרים רק יומנים בבעלות, בדוק calendar.events.owned. בחירת יומן עשויה לדרוש calendar.calendarlist.readonly. בקש את ההרשאה המצומצמת שמתאימה למסלול. [רשימת הרשאות היומן](https://developers.google.com/workspace/calendar/api/auth)

יצירת אירוע: events.insert, תאריכים ו-timezone, attendees. לצירוף Meet השתמש ב-conferenceData.createRequest וב-conferenceDataVersion=1, עם requestId יציב לאותה בקשה. יצירת conference יכולה להיות אסינכרונית; בדוק מצב עד קבלת join URL. sendUpdates שולט בהתראות; מזהה אירוע יציב מסייע למניעת כפילויות. השלב הראשון יכול להשתמש ב-primary בלי UI לבחירת כל היומנים. [יצירת אירועים וקישור לפגישה](https://developers.google.com/workspace/calendar/api/guides/create-events)

## Meet — הקלטה ותמלול
חומרי פגישה נוצרים רק אם הופעלו היכולות המתאימות. ניתן לאתר recordings/transcripts ב-conferenceRecords ולקרוא transcript entries. ההקלטה והתמלול הם חומרים נפרדים; transcript entries דרך Meet API זמינים 30 יום לאחר סיום, לכן אין להמתין לפגישה החודשית הבאה כדי לייבא חומר מורשה. מזהה אירוע ביומן אינו מזהה conference record: יש לשמור mapping של space/code, זמן וה-occurrence המדויק. [חומרי Meet](https://developers.google.com/workspace/meet/api/guides/artifacts)

Meet scopes אפשריים לפי המסלול: meetings.space.readonly או meetings.space.created; settings לפעולות הגדרה. הורדת מדיה דרך Drive היא הרשאה נפרדת, ועשויה לדרוש scope restricted ותהליך אימות נוסף; אין לבקש drive.readonly באופן גורף בלי לבדוק חלופה צרה. [הרשאות Meet ו-Drive](https://developers.google.com/workspace/meet/api/guides/authenticate-authorize)

קיימות הגדרות ל-auto artifacts בחשבונות נתמכים; הפעלה תלויה בתנאים ובהרשאות. מסך יכולת חייב להבדיל בין ״מוגדר להתחיל״ לבין ״התחיל בפועל״. קלוד צריך לבדוק account capability לפני הצגת toggle פעיל. [הגדרות הקלטה ותמלול אוטומטיים](https://developers.google.com/workspace/meet/api/guides/meeting-spaces-configuration)

נכון לבדיקה, עברית אינה ברשימת השפות של תמלול Meet בדף הרשמי. יכולות תמלול תלויות גם במהדורת Workspace ובהגדרות מארגן. אין להסיק מתמיכה בכתוביות שיש תמיכה באותו אופן בתמלול הנשמר. למוצר עברי נדרש מסלול STT מהקלטה זמינה או תמלול שמועלה ידנית. [שפות ותנאי תמלול Meet](https://support.google.com/meet/answer/12849897)

## Microsoft — זהות, Calendar ו-Teams
השתמש ב-Entra app registration וב-authorization code flow עם PKCE באמצעות ספרייה נתמכת. scopes בסיסיים לזהות וגישה מתמשכת: openid/profile/email/offline_access לפי ה-flow. סוג החשבונות המאושרים לאפליקציה חייב להתאים לפיילוט; חשבון ארגוני עשוי לחייב admin consent. Outlook כתוכנת דואר אינו הוכחה שיש mailbox נתמך ב-Microsoft Graph. [תיעוד authorization code](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)

Calendar: delegated Calendars.ReadWrite ליצירת event, למשל POST /me/events. לאירוע Teams השתמש ב-isOnlineMeeting=true וב-onlineMeetingProvider=teamsForBusiness כאשר הספק נתמך ביומן/חשבון; שמור eventId וה-join URL שהוחזר. transactionId קבוע לאותה פעולת יצירה מסייע להימנע מכפילויות. אל תשלח הזמנות בשני ערוצים לאותו אירוע. [יצירת אירוע ב-Graph](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0)

תמלול Teams: רשימת transcripts דורשת הרשאות נפרדות כגון OnlineMeetingTranscript.Read.All במסלול delegated ארגוני. חשבונות Microsoft אישיים אינם נתמכים ב-API הזה. מדיניות tenant עשויה לחסום גישה. יש להשתמש בפגישה מתוזמנת הקשורה לאירוע ביומן, ולא להניח שכל onlineMeeting עצמאי מאפשר אותה שליפה. [רשימת תמלולים](https://learn.microsoft.com/en-us/graph/api/onlinemeeting-list-transcripts?view=graph-rest-1.0)

הקלטות Teams דרך recordings API הן מסלול נוסף; בדוק הרשאות כגון OnlineMeetingRecording.Read.All והגבלות הגישה הרלוונטיות. אלה אינם חלק מ-Calendars.ReadWrite. אין להבטיח הקלטה/תמלול רק כי נוצר אירוע. [רשימת הקלטות](https://learn.microsoft.com/en-us/graph/api/onlinemeeting-list-recordings?view=graph-rest-1.0)

מוצר: צור יכולות נפרדות microsoft_calendar / teams_create / teams_transcript / teams_recording. כשל transcripts לא צריך למנוע שימוש ביומן. אין להשתמש ב-application-wide permissions כקיצור דרך אם delegated מתאים; אם נדרש מסלול אפליקציה יש לתעד admin consent ו-access policy ספציפיים.

## Zoom
חיבור Zoom נפרד מחשבון הכניסה ומהיומן. עבור לקוחות חיצוניים השתמש באפליקציית OAuth מתאימה, לא ב-Server-to-Server של חשבון VITAS כאילו הוא מעניק גישה לכל לקוחות המוצר. יש לשמור tokens מתחלפים באופן אטומי ולתמוך בניתוק. [Zoom OAuth](https://developers.zoom.us/docs/integrations/oauth/)

webhooks צריכים לעבור בדיקת חתימה/אימות endpoint לפי המפרט, ולהיכנס לתור עבודה עם deduplication. אירוע שהפגישה הסתיימה אינו מוכיח שההקלטה או התמלול מוכנים. [Zoom webhooks](https://developers.zoom.us/docs/api/webhooks/)

מסלול implementation לבירור: create meeting עבור host המאומת, קבלת join_url, ואז הכנסת הקישור לאירוע ביומן הנבחר. metadata צריך לכלול host/account/meeting ID וגם occurrence UUID כשהפגישה הסתיימה. אין לשתף start_url של המארגן.

יעדי API לבדיקה במימוש: POST /users/{userId}/meetings, GET /meetings/{meetingId}/recordings, ו-notifications על recording/transcript completed. שמות scopes ו-events הספציפיים חייבים להיבדק בגרסת ה-Marketplace והאפליקציה. דף ה-REST הבא נטען בבדיקה כעמוד JS ללא מפרט נגיש, ולכן אין לטעון שהחתימות/שמות האלה אומתו כאן: [Zoom Meeting API — יעד אימות לקלוד](https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/).

הקלטה מקומית במחשב המשתמש אינה cloud recording ששרת VITAS יכול למשוך. העלאת קובץ היא fallback. מנוי/host settings/שפה/הרשאות ענן חייבים להיבדק בפיילוט. אין להבטיח תמלול עברי מובנה. אין לצרף bot משתתף או לרכוש שירות recording bot במסגרת אפיון זה ללא החלטה נפרדת.

## תמלול עברית וסיכום
מועמד קונקרטי למסלול STT: Azure Speech. he-IL מופיע בשפות הנתמכות; יש לאמת תמיכה של מצב העיבוד וה-region הספציפיים וכן איכות בעברית עם מונחי נדל״ן. [שפות Azure Speech](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=stt)

לישיבות ארוכות ניתן לבחון batch transcription: יצירת job, המתנה לעיבוד ואיסוף תוצאות. הקלטה מורשית עוברת לאחסון פרטי עם גישה מוגבלת, לא ל-public URL. התאמת פורמט אודיו ותנאי הגישה תיבדק מול השירות. [יצירת batch transcription](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/batch-transcription-create)

זו בחירת תכנון מוצעת, לא התקשרות עם ספק. אם כבר יש במאגר STT עברי מתאים, השאר interface להחלפה ובדוק איכות מול אותו מדגם. עלות לתמלול/סיכום ומגבלת משך לכל לקוח צריכות להיות configurable ולהיבדק לפני הפעלה בתשלום. ספק LLM: השתמש במנוע הקיים במאגר אם הוא מתאים; אם אין, השאר adapter והשג החלטת ספק/credentials. אין להמציא endpoint או מודל פעיל בחבילה.

ה-LLM מקבל תמלול ומטא־דאטה מוגבלים, ומחזיר רק טיוטת JSON לפי AI-SUMMARY-CONTRACT.md. הוא אינו מקבל הרשאות לשלוח הזמנות, לשנות תקציבים או לגשת לטוקנים. מקור שאינו ניתן לאימות נשאר שאלה פתוחה ולא משימה מאושרת.

## חיבורי תשתית שקלאוד צריך לזהות/להכין
- DB/ORM הקיימים ו-storage פרטי, כולל migrations ובידוד tenant/project.
- worker/queue עמידים ו-cron לתזכורות; אין להריץ תמלול ארוך ב-request של Next.js או ב-setTimeout בדפדפן.
- שירות מייל עם דומיין VITAS מאומת לשליחת קישור, retries ו-delivery status.
- OAuth apps נפרדות development/production או redirect URIs נפרדים, HTTPS callbacks.
- סודות בצד שרת: Google/Microsoft/Zoom client credentials, encryption key, webhook secrets, STT ו-LLM credentials, mail provider, queue/cron auth. כל השמות הסופיים יותאמו למאגר; לא להציב סודות ב-NEXT_PUBLIC_*.
- טוקנים, תמלולים וכתובות URL חתומות לא נרשמים ללוגים רגילים. ניתוק OAuth וביטול גישה לא מוחקים היסטוריית עסק באופן שקט.
