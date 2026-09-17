'use client';
// Isolated development example ONLY; never mount with production reports.
import ResponseTimes from '../components/ResponseTimes';
import ResponseChart from '../components/ResponseChart';
const labels=['עד 5 דקות','5 עד פחות מ־15','15 עד פחות מ־30','30 עד פחות מ־60','60 דקות ומעלה'];
const datasets=[{id:'answered',label:'לידים עם שיחה',values:[0,1,1,3,1],colorKey:'sky'}];
// Six illustrative completed calls: 10,20,30,40,50,60 working minutes.
// Mean=35, median=35. Two additional leads have no completed conversation.
const missing={state:'missing',message:'חיבור לנתוני הפרויקט הקיימים נדרש'};
export const demoModel={
  definition:'החישוב כולל שעות עבודה בלבד. לידים שטרם התקיימה איתם שיחה מוצגים בנפרד.',
  scope:'נתונים להמחשה בלבד · 8 לידים שנכנסו בתקופה',
  metrics:[
    {id:'mean',label:'זמן מענה ממוצע',value:'35 דקות',tone:'indigo',description:'מתוך 6 לידים עם שיחה'},
    {id:'median',label:'זמן מענה חציוני',value:'35 דקות',tone:'sky',description:'מתוך 6 לידים עם שיחה'},
    {id:'answered',label:'לידים עם שיחה',value:6,tone:'emerald'},
    {id:'pending',label:'טרם התקיימה שיחה',value:2,tone:'amber',description:'מתוך 8 לידים'},
  ],
  panels:{distribution:{state:'ready',scope:'6 לידים עם זמן תגובה תקין; טווחים ללא חפיפה'},weekday:missing,meetingDay:missing,activityHours:missing,unansweredHours:missing},
  reps:{state:'ready',scope:'דוגמה בלבד',rows:[
    {id:'a',cells:{name:'נציג א׳',answered:2,mean:'15 דקות',median:'15 דקות',pending:1}},
    {id:'b',cells:{name:'נציג ב׳',answered:2,mean:'35 דקות',median:'35 דקות',pending:1}},
    {id:'c',cells:{name:'נציג ג׳',answered:2,mean:'55 דקות',median:'55 דקות',pending:0}},
  ]},
  sources:{state:'missing',message:'נתוני מקור לא סופקו בדוגמה'},
};
export default function Example(){return <ResponseTimes model={demoModel} charts={{distribution:<ResponseChart label="התפלגות זמני תגובה" labels={labels} datasets={datasets} unit="לידים" horizontal/>}}/>;}
