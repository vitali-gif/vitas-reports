// Seconds, synced to public/voiceover.mp3 (ElevenLabs take 1, word timestamps from Scribe).
// Nested values are offsets in frames from the scene start.
const f = (sec) => Math.round(sec * 30);

export const TIMELINE = {
  hook: {start: 0}, //            "אתם יודעים כמה עולה ליד" 0.08
  question: {start: 1.8}, //      "אבל אתם יודעים..." 2.06
  silos: {start: 4.7, crm: f(2.2), excel: f(3.95), breaks: f(6.4)}, // 4.9 / 6.9 / 8.66 / 11.12
  funnel: {start: 13.0, steps: [f(2.5), f(3.2), f(4.0), f(5.9)]}, // טובנו 13.18, קליק 15.6, פגישה 16.98, חוזה 18.94
  metrics: {start: 20.0, deal: f(1.25), campaign: f(2.35)}, // 20.2 / 21.28 / 22.36
  cta: {start: 23.4, tagline: f(1.0), button: f(2.75)}, // טובנו 23.6, מליד 24.4, בקשו הדגמה 26.16
};
