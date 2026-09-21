# מה בונים מאחורי המסכים

הסכימה ושמות השירותים להלן מוצעים; התאימו ל-DB/ORM ולתשתיות המאגר. אין כאן migrations להרצה עיוורת.

## ישויות
| ישות | שדות עיקריים |
|---|---|
| UserIdentity | userId, provider, issuer, subject/providerUserId; tenantId ספק כשנדרש; email כתכונה ולא כמפתח הרשאה |
| IntegrationConnection | userId, workspaceId, provider, scopes, encryptedTokens, expiresAt, status, capabilities, capabilitiesCheckedAt |
| MarketingMeeting | id, tenantId, projectId, organizerId, title, startAtUtc, endAtUtc, timezone, calendarConnectionId, calendarId, eventId, conferenceProvider, conferenceId, occurrenceId, joinUrl, status, version |
| MeetingInvitee | meetingId, userId?, email, displayName, invitationStatus; attendance נפרד ומבוסס ספק בלבד |
| AgendaItem | meetingId, type(text/recommendation/task), sourceId?, text, order |
| MeetingArtifact | meetingId, type(recording/transcript), providerArtifactId, status, storageRef?, authorizedExternalUrl?, language?, sourceVersion, digest, retentionUntil |
| TranscriptSegment | artifactId, segmentId, startMs?, endMs?, speakerRef?, text; טקסט ניתן לעריכה רק עם גרסאות |
| SummaryVersion | meetingId, version, sourceArtifactVersion, status(draft/approved), structuredOutput, approvedBy?, approvedAt?, modelVersion?, promptVersion |
| Task | id, tenantId, projectId, meetingId, summaryVersion, sourceSegmentIds, title, assigneeId?, dueAt?, status, completedAt?, implementedAt?, reviewAt?, recommendationId?, baselineSnapshotId? |
| BaselineSnapshot | metricKey, metricDefinitionVersion, filters, population, attributionRule, sourceTimestamp, window, value, numerator?, denominator? |
| Reminder | taskId, recipientId, fireAtUtc, timezone, channel, status, uniqueKey |
| MeetingShare | meetingId, summaryVersion, recipientId/email, permittedResources, expiresAt?, revokedAt?, deliveryStatus |
| Outbox / Job / AuditEvent | durable command, idempotencyKey, attempts, providerResult, actor, timestamps, minimal error details |

משימה אחת נשארת אותה ישות כשמעבירים אותה לישיבה הבאה. הקישור AgendaItem מצביע אליה. אין להעתיק משימה פתוחה בכל חודש לישות חדשה.

## סטטוסים עצמאיים
אל תדחוס את כל המערכת לשדה status אחד.
- ישיבה: draft → scheduling → scheduled → ended; cancelled או scheduling_failed לפי הצורך. זמן סיום מתוכנן אינו הוכחה שהישיבה התקיימה; אפשר לציין ״המועד חלף״ עד אישור/אות ספק.
- חומר: pending → processing → available; unavailable / permission_required / failed בנפרד.
- סיכום: none → generating → draft → approved. שיתוף: not_sent → queued → sent / partial / failed.
- משימה: proposed → open → in_progress → done; blocked / cancelled / needs_details. reviewAt הוא ציר נפרד, לא execution status.

## פקודות שרת מוצעות
הנתיבים הם הצעה פנימית, לא API קיים:
- GET /api/meeting-connections — יכולות וחיבורים ללא tokens.
- POST /api/meeting-connections/:provider/start, callback — bind ל-session/user/tenant המקוריים.
- POST /api/marketing-meetings — יצירת טיוטה ללא פעולות חיצוניות.
- POST /api/marketing-meetings/:id/schedule — בדיקת הרשאות+פרטי מוזמנים ואז outbox ליצירה/הזמנה, עם idempotency key.
- PATCH /api/marketing-meetings/:id — version check; שינוי ישיבה מתוזמנת מפעיל עדכון אצל הספק ואינו יוצר אירוע חדש.
- POST /api/marketing-meetings/:id/cancel — פעולה מפורשת, שימור היסטוריה והודעה למוזמנים דרך הספק.
- POST /api/marketing-meetings/:id/artifacts — upload מורשה או רישום קישור; signed upload, validation סוג/גודל, בדיקת הרשאות לקבצים.
- POST /api/marketing-meetings/:id/summarize — enqueue, אין side effects של משימות חיות או אימייל.
- PATCH /api/marketing-meetings/:id/summary — עריכת טיוטה עם optimistic lock.
- POST /api/marketing-meetings/:id/approve-and-share — גרסה מאושרת+tasks+reminders+outbox בטרנזקציה; recipient snapshot. אין שכפול אם המשתמש לוחץ פעמיים.
- PATCH /api/meeting-tasks/:id — שינוי אחראי/תאריך/ביצוע על ידי מי שמורשה, עם audit ו-revision.
- POST /api/webhooks/:provider — validate, dedupe, enqueue; worker בודק שוב mapping והרשאות לפני fetch.

## תזמון וכשל חלקי
יצירת Zoom ויצירת אירוע ביומן אינן טרנזקציה אחת. שמור checkpoints: conference_created, event_created, invitations_requested. אם היומן נכשל אחרי יצירת הקישור, retry משלים את אותו אירוע; אל תיצור Zoom נוסף. אם אין דרך להמשיך, הצג orphan conference למנהל לפתרון ולא מחיקה שקטה.

ל-Google conference creation ייתכן מצב pending; אל תדווח ״קישור מוכן״ בלי join URL. שמור מזהי בקשה קבועים לאותה פעולה; Microsoft transactionId ו-Google event/conference identifiers לפי כללי הספק. לאחר timeout לא יודעים אם הפעולה הצליחה: reconcile לפני retry חדש.

webhook עשוי להגיע פעמיים, באיחור או בסדר שונה. dedupe לפי event identity וה-artifact version; אין ליצור תמלול/משימות פעמיים. renew subscriptions כשנדרש לפי הספק; fallback polling מוגבל לתקופה/מספר ניסיונות, עם backoff והתחשבות ב-rate limits.

## קליטת חומרים
קישור למפגש אינו קישור להקלטה; metadata אינו קובץ זמין. בדוק יכולת הורדה תחת זהות מורשית. צירוף external URL אינו מעניק permission לעקוף access control. אין fetch חופשי של כתובות: allowlisted provider adapters, חסימת private/internal hosts ו-redirects מסוכנים; uploads נשמרים פרטי.

קובצי TXT/VTT/SRT: בדיקת פורמט/גודל, ניקוי markup, שימור speaker/time כשקיים, source hash למניעת כפילות. קובצי אודיו/וידאו: size/duration bounds, worker conversion לפי צורך, הרשאות storage מוגבלות. אם אין timestamp, קישור למקטע טקסט במקום זמן מומצא.

מנהל יכול לבחור מקור סמכותי כשהועלו תמלולים שונים. אין לדרוס עריכות של סיכום מאושר בעת הגעת חומר מאוחר; צור גרסת טיוטה חדשה והצג diff. שיתוף תמיד מצביע לגרסה מאושרת ידועה; תיקון לאחר שליחה הוא גרסה חדשה ושליחה מפורשת.

## המשימות והמעקב החודשי
ה-AI מציע action/owner/date רק מתוך השיחה. המנהל יכול להשלים. פרטי פעולה לא סגורים אינם חוסמים את כל הסיכום, אך נשמרים needs_details, לא נשלחים לנמען לא מזוהה ולא יוצרים deadline מומצא.

לכל משימה רגילה מספיקים title, assignee כשידוע, dueAt כשידוע ו-reviewAt. המלצה מקושרת ו-baseline הם אופציונליים. קישור של AI להמלצה הוא הצעה שדורשת זיהוי ברור/אישור; אל תחבר המלצות לפי דמיון מילולי בלבד כאמת.

reviewAt מוצע למועד הישיבה הבאה; בהיעדרו המנהל בוחר תאריך. יעד ביצוע ומועד בדיקה אינם אותו שדה. תזכורת dashboard נשלחת פעם אחת לפי taskId+reminderType+revision+date+recipient. שינוי תאריך מבטל job ישן, ביטול משימה מסיר תזכורות עתידיות. העברה לאחראי חדש מעדכנת נמענים.

סימון done שומר completedAt. implementedAt מתאר מתי שינוי עסקי הוחל בפועל, ויכול להיות שונה; שדה קצר אופציונלי במשימות מדידה. שיפור מדד לא מסמן משימה done, ואזכור ״נטפל״ בשיחה אינו ביצוע. משימה שלא בוצעה חוזרת למעקב ביצוע במקום דוח השפעה.

בדיקת השפעה: snapshot שומר הגדרות, מסננים ואוכלוסייה לצד הערך. ההשוואה לפי מועד יישום, זמן התקדמות דומה של לידים, שיוך פרסום זהה וגודל מדגם. תוצאה יכולה להיות improved / worsened / unchanged / insufficient_data, בלי לטעון שהפעולה גרמה לתוצאה. אם אין נתון מקושר, בקש הערכת מנהל במקום להמציא מספר.

## שיתוף והרשאות
כל query/mutation/job מוגבלים ל-tenant+project; אל תסמוך על projectId מהדפדפן. organizer אינו בהכרח admin מערכת. צופה רואה גרסה מאושרת בלבד; מנהל ישיבה ועורכים מורשים רואים טיוטות; אחראי משימה יכול לעדכן את משימתו לפי המדיניות.

מוזמן חיצוני אינו מקבל גישה לכל הדשבורד. שיתוף ספציפי לסיכום מאומת באמצעות sign-in או magic link מוגבל למשאב עם expiry/revocation בהתאם למערכת. אין URL ציבורי קבוע לתמלול/הקלטה. צד הספק עשוי לדרוש הרשאה נוספת לצפייה בהקלטה; שליחת קישור אינה פותרת אותה.

הקלטה ותמלול אינם משותפים כברירת מחדל עם כל נמען סיכום. אכוף permissions לכל משאב וקישור הורדה. התראה למשתתפים על תיעוד ושמירת מדיניות מחיקה/retention נדרשות כחלק מהמוצר. אין לבחור תקופת retention בלתי מוגבלת בלי הגדרה. ניתוק OAuth אינו מוחק חומר שמור; מסך ניהול מאפשר בקשת מחיקה לפי המדיניות.

## תפעול
מדדי תפעול: זמן יצירת אירוע, כשלי ספק, latency קליטת חומר, משך ועלות STT, זמן סיכום, שגיאות validation, שליחות שנכשלו ותזכורות שהתעכבו. אין תמלול/raw tokens בלוגים. worker צריך לשרוד restart, job חייב להיות idempotent. סודות וקריאות API בצד שרת בלבד; rate limiting לפעולות create/share/upload/summarize.
