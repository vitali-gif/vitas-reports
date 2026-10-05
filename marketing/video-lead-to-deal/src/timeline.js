// All times in seconds, synced to public/voiceover.mp3 (ElevenLabs Omer take 1).
// Word timestamps come from an ElevenLabs Scribe transcript of that take.

export const VO = {
  lead: 1.06, //        "ליד"
  ads: 4.9, //          "הפרסום במטא ובגוגל"
  crm: 6.9, //          "הלידים ב-CRM"
  excel: 8.66, //       "הפגישות והעסקאות באקסל"
  connectTry: 10.9, //  thread tries to connect the silos
  snap: 11.94, //       "מחבר" — thread snaps
  brand1: 13.18, //     "טובנו"
  perMeeting: 20.2, //  "עלות לפגישה"
  perDeal: 21.28, //    "עלות לעסקה"
  perCampaign: 22.36, //"לכל קמפיין"
  alert: 22.9, //       weak campaign flagged
  brand2: 23.6, //      "טובנו"
  demo: 26.16, //       "בקשו הדגמה"
};

// Scene boundaries: hook | question | silos | connect | metrics | cta
export const CUTS = [1.8, 4.7, 13.0, 20.0, 23.4];

// [time, strength] — camera shake + white flash
export const HITS = [
  [VO.lead, 0.9],
  [VO.snap, 1],
  [VO.brand1, 0.8],
  [VO.perMeeting, 0.6],
  [VO.perDeal, 0.6],
  [VO.brand2, 0.35],
];

// [time, file in public/audio, volume]
export const SFX = [
  [VO.lead - 0.02, 'impact', 0.7],
  [VO.lead + 0.02, 'ticker', 0.35],
  [1.62, 'whoosh', 0.55],
  [2.7, 'riser', 0.45],
  [4.62, 'glitch', 0.5],
  [VO.ads - 0.1, 'whoosh', 0.4],
  [VO.crm - 0.1, 'whoosh', 0.4],
  [VO.excel - 0.1, 'whoosh', 0.4],
  [VO.connectTry, 'pop', 0.35],
  [VO.snap - 0.02, 'snap', 0.7],
  [VO.snap, 'glitch', 0.55],
  [12.45, 'glitch', 0.3],
  [VO.brand1 - 0.04, 'impact', 0.8],
  [VO.brand1, 'shimmer', 0.5],
  [15.6, 'pop', 0.5],
  [16.25, 'pop', 0.5],
  [16.98, 'pop', 0.5],
  [18.94, 'pop', 0.6],
  [19.85, 'whoosh', 0.5],
  [VO.perMeeting - 0.02, 'impact', 0.55],
  [VO.perMeeting, 'ticker', 0.3],
  [VO.perDeal - 0.02, 'impact', 0.55],
  [VO.perDeal, 'ticker', 0.3],
  [VO.alert, 'alert', 0.45],
  [23.25, 'whoosh', 0.5],
  [VO.brand2, 'sting', 0.65],
  [VO.demo, 'pop', 0.6],
];
