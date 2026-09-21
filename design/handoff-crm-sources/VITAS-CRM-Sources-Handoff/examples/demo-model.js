// DEMONSTRATION ONLY. Never import into a production data adapter.
export const demoModel = {
  metricsScope: 'פעילות בתקופה · כולל פעילות מלידים שנכנסו לפני התקופה',
  metrics: [
    { id:'leads',label:'סה״כ לידים',value:186,tone:'indigo' },
    { id:'relevant',label:'רלוונטיים',value:130,tone:'emerald' },
    { id:'scheduled',label:'פגישות שתואמו',value:32,tone:'sky' },
    { id:'attended',label:'פגישות שבוצעו',value:24,tone:'terra' },
    { id:'future',label:'פגישות עתידיות',value:8,tone:'sky' },
    { id:'cancelled',label:'פגישות שבוטלו',value:4,tone:'amber' },
    { id:'registrations',label:'הרשמות',value:4,tone:'emerald' },
    { id:'contracts',label:'חוזים',value:2,tone:'rose' },
  ],
  funnel: {
    advertising: [{id:'impressions',label:'חשיפות',value:'120,000'},{id:'clicks',label:'קליקים',value:'2,400'}],
    stages: [
      {id:'leads',label:'לידים',value:186},
      {id:'contact',label:'נוצר קשר',value:130,rate:'69.9%',denominatorLabel:'מתוך 186 לידים'},
      {id:'scheduled',label:'פגישה נקבעה',value:26,rate:'20%',denominatorLabel:'מתוך 130 שנוצר עמם קשר'},
      {id:'attended',label:'הגיעו לפגישה',value:16,rate:'61.5%',denominatorLabel:'מתוך 26 פגישות שנקבעו',smallSample:true},
      {id:'registrations',label:'הרשמות',value:3,rate:'18.8%',denominatorLabel:'מתוך 16 שהגיעו',smallSample:true},
      {id:'contracts',label:'חוזים',value:1,rate:'33.3%',denominatorLabel:'מתוך 3 הרשמות',smallSample:true},
    ],
    cancellation:{parentStageId:'scheduled',value:4,denominatorLabel:'מתוך 26 פגישות שנקבעו'},
    scopeNote:'חשיפות וקליקים: נתוני הפרסום בתקופה. מלידים והלאה: התקדמות הלידים שנכנסו בתקופה.',
  },
  table: {
    scopeNote:'דוגמת תצוגה: לידים שנכנסו בתקופה והתקדמותם עד היום',
    rateNote:'בדוגמה: % תיאום ו־% ביצוע מחושבים מתוך הלידים בכל מקור',
    rows:[
      {id:'facebook',cells:{source:'Facebook',leads:100,relevant:70,irrelevant:30,scheduled:14,scheduleRate:'14%',attended:8,attendRate:'8%',cancelled:2,registrations:1,registrationValue:'₪2,400,000',contracts:0,contractValue:'₪0'}},
      {id:'google',cells:{source:'Google',leads:50,relevant:35,irrelevant:15,scheduled:8,scheduleRate:'16%',attended:5,attendRate:'10%',cancelled:1,registrations:1,registrationValue:'₪2,600,000',contracts:1,contractValue:'₪2,600,000'}},
      {id:'site',cells:{source:'אתר הפרויקט',leads:24,relevant:17,irrelevant:7,scheduled:3,scheduleRate:'12.5%',attended:2,attendRate:'8.3%',cancelled:1,registrations:1,registrationValue:'₪2,500,000',contracts:0,contractValue:'₪0'}},
      {id:'referral',cells:{source:'הפניות',leads:12,relevant:8,irrelevant:4,scheduled:1,scheduleRate:'8.3%',attended:1,attendRate:'8.3%',cancelled:0,registrations:0,registrationValue:'₪0',contracts:0,contractValue:'₪0'}},
    ],
    total:{id:'total',cells:{source:'סה״כ',leads:186,relevant:130,irrelevant:56,scheduled:26,scheduleRate:'14%',attended:16,attendRate:'8.6%',cancelled:4,registrations:3,registrationValue:'₪7,500,000',contracts:1,contractValue:'₪2,600,000'}},
  },
  distributionScope:'186 לידים בתקופה · נתונים להמחשה',
};
export const demoDistribution=[{id:'facebook',label:'Facebook',value:100},{id:'google',label:'Google',value:50},{id:'site',label:'אתר הפרויקט',value:24},{id:'referral',label:'הפניות',value:12}];
