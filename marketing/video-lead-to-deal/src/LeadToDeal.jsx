import '@fontsource/heebo/400.css';
import '@fontsource/heebo/500.css';
import '@fontsource/heebo/700.css';
import '@fontsource/heebo/800.css';
import '@fontsource/heebo/900.css';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';
import {TIMELINE} from './timeline';

export const FPS = 30;
export const DURATION = 30 * FPS;

// Tovno tokens (app/globals.css)
const C = {
  brand: '#315CF5',
  brandSoft: '#EEF2FF',
  brandLine: '#C8D4FF',
  navy: '#14243C',
  navy2: '#1D3150',
  canvas: '#F5F7FC',
  border: '#DCE3EF',
  text: '#14243C',
  text2: '#52627A',
  muted: '#B7C4DA',
  success: '#08744A',
  successBg: '#E8F7EF',
  danger: '#C2410C',
  dangerBg: '#FFF1EB',
};

const font = 'Heebo, sans-serif';
const s = (sec) => Math.round(sec * FPS);

const useEnter = (delay = 0, damping = 16) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - delay, fps, config: {damping, mass: 0.8}});
};

const Rise = ({delay = 0, children, style}) => {
  const p = useEnter(delay);
  return (
    <div style={{opacity: p, transform: `translateY(${(1 - p) * 60}px)`, ...style}}>{children}</div>
  );
};

const CountUp = ({to, delay = 0, dur = 24, prefix = '', suffix = ''}) => {
  const frame = useCurrentFrame();
  const v = interpolate(frame, [delay, delay + dur], [0, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return (
    <span style={{fontVariantNumeric: 'tabular-nums'}}>
      {prefix}
      {Math.round(v).toLocaleString('en-US')}
      {suffix}
    </span>
  );
};

const Bg = ({light}) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 60) * 40;
  return (
    <AbsoluteFill
      style={{
        background: light
          ? C.canvas
          : `radial-gradient(circle at ${50 + drift / 10}% ${30 + drift / 20}%, #24407A 0%, ${C.navy} 55%, #0C1626 100%)`,
      }}
    />
  );
};

const Stage = ({children, light}) => (
  <AbsoluteFill style={{fontFamily: font, direction: 'rtl', color: light ? C.text : '#fff'}}>
    <Bg light={light} />
    <AbsoluteFill style={{padding: '260px 80px 520px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 40}}>
      {children}
    </AbsoluteFill>
  </AbsoluteFill>
);

const Card = ({children, style}) => (
  <div
    style={{
      background: '#fff',
      color: C.text,
      borderRadius: 36,
      padding: '44px 52px',
      boxShadow: '0 30px 80px rgba(8,18,40,0.35)',
      ...style,
    }}
  >
    {children}
  </div>
);

/* 1 — "You know what a lead costs" */
const Hook = () => (
  <Stage>
    <Rise>
      <div style={{fontSize: 96, fontWeight: 900, lineHeight: 1.1}}>אתם יודעים כמה עולה ליד.</div>
    </Rise>
    <Rise delay={10}>
      <Card style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <div style={{fontSize: 46, fontWeight: 500, color: C.text2}}>עלות לליד</div>
        <div style={{fontSize: 110, fontWeight: 800, color: C.success}}>
          <CountUp to={142} delay={14} prefix="₪" />
        </div>
      </Card>
    </Rise>
  </Stage>
);

/* 2 — "...but what did the sold apartment cost?" */
const Question = () => {
  const frame = useCurrentFrame();
  const pulse = 1 + Math.sin(frame / 4) * 0.04;
  return (
    <Stage>
      <Rise>
        <div style={{fontSize: 88, fontWeight: 900, lineHeight: 1.15}}>
          אבל כמה עלתה <span style={{color: '#8FA9FF'}}>הדירה שנמכרה?</span>
        </div>
      </Rise>
      <Rise delay={8}>
        <Card style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <div style={{fontSize: 46, fontWeight: 500, color: C.text2}}>עלות לעסקה</div>
          <div style={{fontSize: 130, fontWeight: 900, color: C.danger, transform: `scale(${pulse})`}}>?</div>
        </Card>
      </Rise>
    </Stage>
  );
};

/* 3 — the silos */
const Silo = ({title, sub, icon, delay}) => {
  const p = useEnter(delay);
  return (
    <div
      style={{
        opacity: p,
        transform: `translateX(${(1 - p) * -120}px)`,
        background: 'rgba(255,255,255,0.08)',
        border: '2px solid rgba(255,255,255,0.18)',
        borderRadius: 32,
        padding: '36px 44px',
        display: 'flex',
        alignItems: 'center',
        gap: 32,
      }}
    >
      <div style={{fontSize: 72, width: 90, textAlign: 'center'}}>{icon}</div>
      <div>
        <div style={{fontSize: 56, fontWeight: 800}}>{title}</div>
        <div style={{fontSize: 40, color: C.muted, fontWeight: 500}}>{sub}</div>
      </div>
    </div>
  );
};

const Break = ({delay}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [delay, delay + 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const shake = frame > delay && frame < delay + 12 ? Math.sin(frame * 3) * 6 : 0;
  return (
    <div style={{display: 'flex', justifyContent: 'center', opacity: o, transform: `translateX(${shake}px)`, height: 70, margin: '-20px 0'}}>
      <svg width="90" height="70" viewBox="0 0 90 70">
        <path d="M45 0 L45 22 M45 48 L45 70" stroke="#FF7A45" strokeWidth="6" strokeLinecap="round" strokeDasharray="8 8" />
        <path d="M33 23 L57 47 M57 23 L33 47" stroke="#FF7A45" strokeWidth="8" strokeLinecap="round" />
      </svg>
    </div>
  );
};

const Silos = () => {
  const t = TIMELINE.silos;
  return (
    <Stage>
      <Silo icon="📣" title="פרסום" sub="מטא · גוגל" delay={0} />
      <Break delay={t.breaks} />
      <Silo icon="🗂️" title="לידים" sub="CRM" delay={t.crm} />
      <Break delay={t.breaks + 4} />
      <Silo icon="📊" title="פגישות ועסקאות" sub="אקסל" delay={t.excel} />
      <Rise delay={t.breaks + 6}>
        <div style={{fontSize: 64, fontWeight: 900, color: '#FF9466', textAlign: 'center', marginTop: 10}}>
          ואף אחד לא מחבר ביניהם.
        </div>
      </Rise>
    </Stage>
  );
};

/* 4 — Tovno connects everything: funnel */
const FUNNEL = [
  {label: 'קליקים', value: 48200, w: 1},
  {label: 'לידים', value: 1260, w: 0.78},
  {label: 'פגישות במשרד המכירות', value: 186, w: 0.56},
  {label: 'חוזים חתומים', value: 22, w: 0.36},
];

const Funnel = () => {
  const frame = useCurrentFrame();
  const t = TIMELINE.funnel;
  const logo = useEnter(0, 14);
  return (
    <Stage light>
      <div style={{display: 'flex', alignItems: 'center', gap: 24, opacity: logo, transform: `scale(${0.8 + logo * 0.2})`}}>
        <Img src={staticFile('tovno-logo.svg')} style={{height: 120}} />
      </div>
      <Rise delay={6}>
        <div style={{fontSize: 68, fontWeight: 900, lineHeight: 1.15}}>
          מחברת הכול <span style={{color: C.brand}}>לדשבורד אחד</span>
        </div>
        <div style={{fontSize: 40, fontWeight: 500, color: C.text2, marginTop: 14}}>מהקליק הראשון ועד החוזה החתום</div>
      </Rise>
      <Card style={{boxShadow: '0 20px 60px rgba(20,36,60,0.12)', border: `2px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 26}}>
        {FUNNEL.map((row, i) => {
          const d = t.steps[i];
          const grow = interpolate(frame, [d, d + 16], [0, row.w], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.out(Easing.cubic),
          });
          const last = i === FUNNEL.length - 1;
          return (
            <div key={row.label} style={{opacity: interpolate(frame, [d - 4, d + 4], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
              <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 38, fontWeight: 600, color: C.text2, marginBottom: 10}}>
                <span>{row.label}</span>
                <span style={{fontWeight: 800, color: last ? C.success : C.text}}>
                  <CountUp to={row.value} delay={d} dur={18} />
                </span>
              </div>
              <div style={{height: 34, background: C.brandSoft, borderRadius: 17, overflow: 'hidden'}}>
                <div
                  style={{
                    height: '100%',
                    width: `${grow * 100}%`,
                    borderRadius: 17,
                    background: last ? C.success : `linear-gradient(270deg, ${C.brand}, #6E8CFF)`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </Card>
    </Stage>
  );
};

/* 5 — cost per meeting / per deal / per campaign */
const CAMPAIGNS = [
  {name: 'מגדל הים · מטא', leads: 540, deals: 12, cpd: 6100, good: true},
  {name: 'פנטהאוזים · גוגל', leads: 310, deals: 7, cpd: 7900, good: true},
  {name: 'וידאו כללי · מטא', leads: 410, deals: 3, cpd: 19400, good: false},
];

const Kpi = ({label, value, delay, color}) => (
  <Rise delay={delay} style={{flex: 1}}>
    <Card style={{padding: '36px 36px', boxShadow: '0 20px 60px rgba(20,36,60,0.12)', border: `2px solid ${C.border}`}}>
      <div style={{fontSize: 38, color: C.text2, fontWeight: 600}}>{label}</div>
      <div style={{fontSize: 84, fontWeight: 900, color}}>
        <CountUp to={value} delay={delay + 4} prefix="₪" />
      </div>
    </Card>
  </Rise>
);

const Metrics = () => {
  const t = TIMELINE.metrics;
  const frame = useCurrentFrame();
  return (
    <Stage light>
      <div style={{display: 'flex', gap: 30}}>
        <Kpi label="עלות לפגישה" value={962} delay={0} color={C.brand} />
        <Kpi label="עלות לעסקה" value={8132} delay={t.deal} color={C.success} />
      </div>
      <Rise delay={t.campaign}>
        <Card style={{padding: '30px 40px', boxShadow: '0 20px 60px rgba(20,36,60,0.12)', border: `2px solid ${C.border}`}}>
          <div style={{fontSize: 40, fontWeight: 800, marginBottom: 16}}>לכל קמפיין</div>
          <div style={{display: 'flex', fontSize: 30, color: C.text2, fontWeight: 600, padding: '0 0 12px', borderBottom: `2px solid ${C.border}`}}>
            <span style={{flex: 2.2}}>קמפיין</span>
            <span style={{flex: 1}}>לידים</span>
            <span style={{flex: 1}}>עסקאות</span>
            <span style={{flex: 1.4}}>עלות לעסקה</span>
          </div>
          {CAMPAIGNS.map((c, i) => {
            const d = t.campaign + 6 + i * 5;
            const o = interpolate(frame, [d, d + 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
            const flag = !c.good && frame > d + 14;
            return (
              <div
                key={c.name}
                style={{
                  opacity: o,
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 36,
                  fontWeight: 600,
                  padding: '18px 12px',
                  margin: '0 -12px',
                  borderRadius: 16,
                  background: flag ? C.dangerBg : 'transparent',
                }}
              >
                <span style={{flex: 2.2}}>{c.name}</span>
                <span style={{flex: 1}}>{c.leads}</span>
                <span style={{flex: 1}}>{c.deals}</span>
                <span style={{flex: 1.4, fontWeight: 800, color: c.good ? C.success : C.danger}}>₪{c.cpd.toLocaleString('en-US')}</span>
              </div>
            );
          })}
        </Card>
      </Rise>
      <div style={{fontSize: 26, color: C.text2, textAlign: 'center'}}>* נתונים להמחשה</div>
    </Stage>
  );
};

/* 6 — CTA */
const Cta = () => {
  const frame = useCurrentFrame();
  const t = TIMELINE.cta;
  const btn = useEnter(t.button, 12);
  const glow = 0.5 + Math.sin(frame / 6) * 0.5;
  return (
    <Stage>
      <Rise style={{display: 'flex', justifyContent: 'center'}}>
        <Img src={staticFile('tovno-logo-white.svg')} style={{height: 190}} />
      </Rise>
      <Rise delay={t.tagline}>
        <div style={{fontSize: 104, fontWeight: 900, textAlign: 'center', lineHeight: 1.1}}>
          מליד <span style={{color: '#8FA9FF'}}>←</span> ועד עסקה
        </div>
      </Rise>
      <div style={{display: 'flex', justifyContent: 'center', marginTop: 30}}>
        <div
          style={{
            opacity: btn,
            transform: `scale(${0.7 + btn * 0.3})`,
            background: C.brand,
            color: '#fff',
            fontSize: 64,
            fontWeight: 800,
            padding: '30px 90px',
            borderRadius: 999,
            boxShadow: `0 0 ${40 + glow * 50}px rgba(49,92,245,${0.45 + glow * 0.35})`,
          }}
        >
          בקשו הדגמה
        </div>
      </div>
      <Rise delay={t.button + 8}>
        <div style={{fontSize: 40, color: C.muted, textAlign: 'center', fontWeight: 500}}>לחברות יזמות ולמנהלות שיווק בנדל״ן</div>
      </Rise>
    </Stage>
  );
};

const SCENES = [
  ['hook', Hook],
  ['question', Question],
  ['silos', Silos],
  ['funnel', Funnel],
  ['metrics', Metrics],
  ['cta', Cta],
];

export const LeadToDeal = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: C.navy}}>
      {SCENES.map(([key, Comp], i) => {
        const from = s(TIMELINE[key].start);
        const to = i < SCENES.length - 1 ? s(TIMELINE[SCENES[i + 1][0]].start) : DURATION;
        const fade = interpolate(frame, [to - 6, to], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        return (
          <Sequence key={key} from={from} durationInFrames={to - from}>
            <AbsoluteFill style={{opacity: i < SCENES.length - 1 ? fade : 1}}>
              <Comp />
            </AbsoluteFill>
          </Sequence>
        );
      })}
      <Audio src={staticFile('voiceover.mp3')} />
    </AbsoluteFill>
  );
};
