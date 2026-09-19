# API וכללי נתונים

```jsx
import FacebookView from './FacebookView';
<FacebookView model={viewModel} state={pageState} onRetry={retry}
  expandedCampaigns={expandedIds} onCampaignToggle={toggleCampaign}
  campaignSort={campaignSort} onCampaignSort={sortCampaigns}
  genderSort={genderSort} onGenderSort={sortGender}
  ageSort={ageSort} onAgeSort={sortAge}
  additionalContent={existingExtraBlocks} />
```

model יכול להיות null כאשר state אינו ready. מצבים: ready/loading/empty/missing/error. כל אזור מקבל state עצמאי; מקור CRM מנותק אינו צריך להסתיר נתוני פרסום זמינים. בזמן שינוי פרויקט/תאריך יש להימנע מהצגת model ישן תחת כותרת חדשה ולמנוע מרוץ בין בקשות.

## model
- scope: תיאור טאב והיקף השיוך האמיתי.
- activity: {state,message?,scope,metrics}. metrics: [{id,label,value,description?,tone,icon?,details?}]. ערך null מוצג ״אין נתון״. אין לאפס נתוני CRM חסרים.
- advertising: {state,message?,items:[{id,label,value}]}. סדר RTL: חשיפות ואז קליקים. הגדרת קליקים/חשיפות חייבת להיות המדד הקיים ב-Meta, לא החלפה שקטה בין link clicks/all clicks/reach.
- cohort: {state,message?,scope,note,stages:[{id,label,value,rate?,denominatorLabel?,tone?,icon?}]}. התקדמות הלידים שנוצרו בתקופה; זמן חתך/מועד עדכון לפי המערכת.
- campaigns, gender, age: {state,message?,scope,columns,rows,summaryNote?}. columns: [{key,label,numeric?,sortable?}]. rows: [{id,cells:{[key]:ReactNode},children?:rows[],accessibleLabel?}]. כל ID יציב ומקורי.
- ads: {state,message?,scope,items:[{id,title,src,alt,ratio,metrics,destinationUrl?,onOpen?}]}. metrics: [{id,label,value}]. ratio: '1:1'/'16:9' או יחס לא מוכר שמשאיר נכס מקורי. destinationUrl רק כתובת http(s) מאומתת מהמערכת; לא טקסט חופשי בלתי מהימן. שימוש בתצוגת מודעה/וידאו קיימת עדיף אם חוזה זה אינו מספיק.

ReportTable המצורף אינו מרנדר tfoot נפרד. אם קיימת שורת סיכום במערכת, שימרו את רכיב הסיכום המקורי או הרחיבו באופן ממוקד עם tfoot; אין למחוק סיכום או להוסיף אותו כקמפיין בר־פתיחה. summaryNote מיועד להסבר טקסט, לא תחליף לכל מדדי הסיכום.

## שיוך Facebook
יש לברר מה כולל הטאב כיום: נתוני Meta עשויים לכלול Instagram ופלייסמנטים נוספים. השאר את שם הטאב לפי המערכת, אך אל תסנן Instagram או תציג טענה ״Facebook בלבד״ אם הנתונים הם כלל Meta.

כרטיסי CRM והמשפך חייבים להיות מסוננים לפי כללי השיוך הקיימים ל-Facebook/Meta. אין להציג נתוני CRM של כל הפרויקט תחת כותרת Facebook, ואין לנחש שיוך לפי טקסט שאינו מפה מוסכמת. מקור לא מזוהה נשאר חסר/לא משויך לפי הכללים הקיימים.

Meta leads וספירת לידים ב-CRM אינם בהכרח אותו מדד: יש הבדלים אפשריים במקור, ייחוס, זמן, כפילויות ושיטת ספירה. שימרו את הבחירה המקורית לכל אזור והסבירו מה נספר; אין לכפות שוויון באמצעות שינוי נתונים. גם תוצאות פרסום שנזקפו בחלון ייחוס שונות מפעילות CRM בתקופה.

## חישובים, היררכיה ופילוחים
ההורה אחראי למיון לפי נתונים גולמיים ולא מחרוזות מטבע/אחוז. בפתיחת קמפיין שימרו את הילדים הנכונים (קבוצות/מודעות), בלי לסכם הורה וילד פעמיים. פילוחי מגדר וגיל אינם חלוקות שניתן לחבר זו לזו. קטגוריות לא ידועות/חסרות או מגבלות API אינן אפס.

שמרו CTR, CPM, CPC, CPL וכל נוסחה קיימת. סיכום יחסים מחושב מהסכומים התואמים ולא ממוצע של אחוזי שורות. מכנה אפס נותן ערך חסר לפי המערכת, לא Infinity. אין להסיק מכך על איכות קמפיין ללא יעד.

״המודעות המובילות״ נבחרות לפי הקריטריון הקיים. אל תחליפו דירוג לפי לידים בדירוג לפי קליקים או CPL בגלל הסקיצה. ads.scope צריך להסביר את הקריטריון כאשר הוא ידוע. שמרו קישורים, preview ופעולות קיימות ורק למי שמורשה.

## תמונות
קבצי המדיה בתמונה הם להמחשה בלבד. השתמשו במודעות המקוריות, metadata וגישה קיימת. אין ליצור או להעלות קריאייטיב חדש. מקור חסר מציג placeholder; יש לשמר טיפול בכשל טעינה/כתובת שפגה מה-renderer הקיים או להוסיף onError בעת שילוב, משום שרכיב הבסיס מטפל ב-src חסר בלבד.
