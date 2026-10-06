// "Meeting room" ad (v3) — script by Vitali: 247 leads, nobody smiles, the developer asks
// what happened to them, Tovno answers. All times in seconds, synced to public/v3/vo/*.
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
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';

export const M_FPS = 30;
export const M_DURATION = 31 * M_FPS;

const C = {
  brand: '#315CF5',
  brandLight: '#8FA9FF',
  navy: '#14243C',
  deep: '#0B1626',
  muted: '#B7C4DA',
  text2: '#52627A',
  success: '#2FD08A',
  amber: '#FFB547',
  danger: '#FF5A36',
};
const font = 'Heebo, sans-serif';
const CL = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'};
const f = (s) => Math.round(s * M_FPS);
const ease = Easing.inOut(Easing.cubic);
const ramp = (frame, a, b, from = 0, to = 1, easing = Easing.out(Easing.cubic)) =>
  interpolate(frame, [f(a), f(b)], [from, to], {...CL, easing});
const useSpring = (at, config = {damping: 13, mass: 0.6}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - f(at), fps, config});
};

/* ───────── timeline ───────── */

// [file, start]
const VO = [
  ['a01', 0.05], //  מאיה: 247 לידים החודש!
  ['a02', 3.2], //   קריין: אז למה אף אחד לא מחייך?
  ['a03', 5.45], //  היזם: רגע, וכמה מהם התקדמו?
  ['a04', 7.55], //  מכירות: אני בודק…
  ['a05', 8.95], //  שיווק: זה אצל המכירות
  ['a06', 11.05], // מכירות: יש לי אקסל אחר
  ['a07a', 12.75], // אתם יודעים כמה לידים הגיעו.
  ['a07b', 14.55], // מה קרה להם אחר כך?
  ['a08a', 16.0], //  תכירו את טובנו.
  ['a08b', 17.3], //  מהפרסום — עד העסקה.
  ['a09a', 19.6], //  מה מביא פגישות?
  ['a09b', 21.0], //  איפה לידים נתקעים?
  ['a09c', 22.65], // ומה הופך לעסקאות?
  ['a10a', 24.25], // אוקיי.
  ['a10b', 25.1], //  אז מה עושים עכשיו?
  ['a11a', 26.55], // טובנו.
  ['a11b', 27.25], // להבין מה עובד.
  ['a11c', 28.5], //  לדעת מה לקדם.
];

const T = {
  freeze: 3.0,
  zoomOut: [4.75, 5.65],
  recede: 12.6,
  logo: 15.9,
  arrange: 17.3,
  glimpse: 19.3,
  focus: [19.55, 20.95, 22.6],
  backToTable: 24.0,
  cta: 26.4,
  button: 28.55,
};

// [time, file, volume]
const SFX = [
  [0.05, 'v3/sfx/confetti', 0.55],
  [2.92, 'v3/sfx/scratch', 0.6],
  [4.7, 'v3/sfx/zoomout', 0.5],
  [5.4, 'v3/sfx/bubble', 0.45],
  [5.7, 'audio/pop', 0.25],
  [7.5, 'v3/sfx/bubble', 0.45],
  [8.9, 'v3/sfx/bubble', 0.45],
  [11.0, 'v3/sfx/bubble', 0.45],
  [12.15, 'v3/sfx/cricket', 0.5],
  [12.6, 'audio/whoosh', 0.3],
  [14.5, 'audio/impact', 0.3],
  [T.logo - 0.05, 'audio/sting', 0.45],
  [T.logo, 'audio/shimmer', 0.35],
  [T.arrange, 'v3/sfx/cards', 0.6],
  [T.glimpse - 0.1, 'audio/whoosh', 0.4],
  [T.focus[0], 'v3/sfx/ding', 0.35],
  [T.focus[1], 'v3/sfx/ding', 0.35],
  [T.focus[2], 'v3/sfx/ding', 0.35],
  [T.backToTable - 0.1, 'audio/whoosh', 0.35],
  [24.2, 'v3/sfx/bubble', 0.45],
  [T.cta - 0.1, 'audio/whoosh', 0.3],
  [T.cta + 0.1, 'audio/shimmer', 0.35],
  [T.button, 'audio/pop', 0.55],
];

/* ───────── shared bits ───────── */

const Grain = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{mixBlendMode: 'overlay', opacity: 0.1, pointerEvents: 'none'}}>
      <svg width="100%" height="100%">
        <filter id="m-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={frame % 12} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#m-grain)" />
      </svg>
    </AbsoluteFill>
  );
};

const Word = ({children, at, color = '#fff', glow}) => {
  const frame = useCurrentFrame();
  const p = useSpring(at, {damping: 12, mass: 0.55});
  return (
    <span
      style={{
        display: 'inline-block',
        opacity: interpolate(frame, [f(at), f(at) + 3], [0, 1], CL),
        color,
        transform: `translateY(${(1 - p) * 40}px) scale(${0.6 + 0.4 * p})`,
        filter: `blur(${Math.max(0, 1 - p) * 10}px)`,
        textShadow: glow ? `0 0 36px ${glow}` : '0 6px 28px rgba(0,0,0,0.55)',
        margin: '0 0.11em',
      }}
    >
      {children}
    </span>
  );
};

const Line = ({children, size = 90, weight = 900, style}) => (
  <div style={{direction: 'rtl', fontFamily: font, fontWeight: weight, fontSize: size, lineHeight: 1.1, textAlign: 'center', letterSpacing: -1, ...style}}>
    {children}
  </div>
);

const Bubble = ({at, out = 99, x, y, w, tail = 'bottom-right', children, tone = 'light', size = 46}) => {
  const frame = useCurrentFrame();
  const p = useSpring(at, {damping: 11, mass: 0.5});
  const o = interpolate(frame, [f(out), f(out) + 6], [1, 0], CL);
  if (frame < f(at)) return null;
  const dark = tone === 'dark';
  const bg = dark ? C.brand : '#fff';
  const tails = {
    'bottom-right': {bottom: -18, right: 46, borderWidth: '20px 0 0 22px', borderColor: `${bg} transparent transparent transparent`},
    'bottom-left': {bottom: -18, left: 46, borderWidth: '20px 22px 0 0', borderColor: `${bg} transparent transparent transparent`},
    'top-left': {top: -18, left: 46, borderWidth: '0 22px 20px 0', borderColor: `transparent transparent ${bg} transparent`},
    left: {left: -20, top: 36, borderWidth: '12px 22px 12px 0', borderColor: `transparent ${bg} transparent transparent`},
  };
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        opacity: o,
        transform: `scale(${p})`,
        transformOrigin: tail.includes('left') ? '10% 100%' : '90% 100%',
      }}
    >
      <div
        style={{
          position: 'relative',
          background: bg,
          color: dark ? '#fff' : C.navy,
          borderRadius: 30,
          padding: '20px 28px',
          fontFamily: font,
          fontWeight: 800,
          fontSize: size,
          lineHeight: 1.2,
          direction: 'rtl',
          textAlign: 'center',
          boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
        }}
      >
        {children}
        <div style={{position: 'absolute', width: 0, height: 0, borderStyle: 'solid', ...tails[tail]}} />
      </div>
    </div>
  );
};

const Tag = ({at, x, y, children, color}) => {
  const p = useSpring(at, {damping: 10, mass: 0.5});
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `translate(-50%, -50%) scale(${p})`,
        background: color,
        color: '#fff',
        fontFamily: font,
        fontWeight: 800,
        fontSize: 36,
        padding: '10px 26px',
        borderRadius: 999,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        direction: 'rtl',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </div>
  );
};

/* ───────── the meeting table world ───────── */

// Illustration is 1152×2048, shown as 1080×1920. Points below are in frame px.
const CARD = {x: 531, y: 1150, w: 400, h: 250};
const SEATS = {dev: [527, 330], sales: [180, 954], mkt: [900, 936]};

const ReportCard = ({organized}) => {
  if (organized) {
    const steps = [
      ['פרסום', '₪62K'],
      ['לידים', '247'],
      ['פגישות', '64'],
      ['עסקאות', '9'],
    ];
    return (
      <div style={{width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, padding: '0 18px', boxSizing: 'border-box'}}>
        <div style={{fontSize: 22, fontWeight: 800, color: C.text2, textAlign: 'center'}}>מליד ועד עסקה</div>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', direction: 'rtl'}}>
          {steps.map(([label, v], i) => (
            <div key={label} style={{display: 'flex', alignItems: 'center'}}>
              <div style={{textAlign: 'center', width: 76}}>
                <div style={{fontSize: 30, fontWeight: 900, color: i === 3 ? '#08744A' : C.brand, direction: 'ltr'}}>{v}</div>
                <div style={{fontSize: 18, fontWeight: 700, color: C.text2}}>{label}</div>
              </div>
              {i < 3 && <div style={{fontSize: 20, color: C.brandLight, margin: '0 2px'}}>←</div>}
            </div>
          ))}
        </div>
        <div style={{height: 10, borderRadius: 5, background: '#EEF2FF', overflow: 'hidden', direction: 'rtl'}}>
          <div style={{width: '100%', height: '100%', background: `linear-gradient(270deg, ${C.brand}, ${C.success})`}} />
        </div>
      </div>
    );
  }
  return (
    <div style={{width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}}>
      <div style={{fontSize: 22, fontWeight: 700, color: C.text2, marginBottom: -6}}>דוח שיווק · החודש</div>
      <div style={{fontSize: 128, fontWeight: 900, color: C.brand, lineHeight: 1, letterSpacing: -4}}>247</div>
      <div style={{fontSize: 34, fontWeight: 800, color: C.navy}}>לידים החודש</div>
    </div>
  );
};

// Camera: zoomed into the card for the hook, then pulls out to reveal the room.
const TableWorld = ({organized, children, zoomFrom = 2.55, zoomAt = T.zoomOut, cardScale = 1}) => {
  const frame = useCurrentFrame();
  const z = interpolate(frame, [f(zoomAt[0]), f(zoomAt[1])], [zoomFrom, 1], {...CL, easing: ease});
  const drift = 1 + (frame % 900) * 0.00004;
  // keep the card centred while zoomed in
  const tx = (540 - CARD.x) * (z - 1);
  const ty = (960 - CARD.y) * (z - 1);
  return (
    <AbsoluteFill style={{transform: `translate(${tx}px, ${ty}px) scale(${z * drift})`, transformOrigin: `${CARD.x}px ${CARD.y}px`}}>
      <Img src={staticFile('v3/table.png')} style={{position: 'absolute', width: 1080, height: 1920}} />
      <div
        style={{
          position: 'absolute',
          left: CARD.x - CARD.w / 2,
          top: CARD.y - CARD.h / 2,
          width: CARD.w,
          height: CARD.h,
          background: '#fff',
          borderRadius: 22,
          boxShadow: '0 20px 50px rgba(10,20,40,0.35)',
          fontFamily: font,
          direction: 'rtl',
          overflow: 'hidden',
          transform: `scale(${cardScale})`,
        }}
      >
        <ReportCard organized={organized} />
      </div>
      {children}
    </AbsoluteFill>
  );
};

const Confetti = () => {
  const frame = useCurrentFrame();
  // frozen after T.freeze
  const fr = Math.min(frame, f(T.freeze));
  const colors = [C.brand, C.amber, C.success, '#FF7AB6', C.brandLight, '#fff'];
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {Array.from({length: 70}).map((_, i) => {
        const x0 = 540 + (random(`cx${i}`) - 0.5) * 300;
        const vx = (random(`cvx${i}`) - 0.5) * 34;
        const vy = -28 - random(`cvy${i}`) * 26;
        const t = fr / 2;
        const x = x0 + vx * t;
        const y = 1000 + vy * t + 0.9 * t * t;
        const rot = fr * (8 + random(`cr${i}`) * 14);
        const w = 14 + random(`cw${i}`) * 14;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: w,
              height: w * 0.45,
              background: colors[i % colors.length],
              transform: `rotate(${rot}deg)`,
              borderRadius: 3,
              opacity: 0.95,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/* ───────── scenes ───────── */

// 0 – 12.6: the card, the freeze, the room, the awkward answers
const Room = () => {
  const frame = useCurrentFrame();
  const t = frame / M_FPS;
  const frozen = t >= T.freeze;
  const unfreeze = ramp(frame, T.zoomOut[0], T.zoomOut[1]);
  const grey = frozen ? 1 - unfreeze * 0.6 : 0;
  const numberPop = useSpring(0.0, {damping: 9, mass: 0.6});
  const questionOut = ramp(frame, T.zoomOut[0], T.zoomOut[0] + 0.25);
  // awkward silence: everybody holds, the camera creeps in
  const creep = ramp(frame, 11.9, 12.6, 0, 1, Easing.inOut(Easing.quad));
  return (
    <AbsoluteFill style={{filter: `grayscale(${grey * 0.85}) brightness(${1 - grey * 0.25})`}}>
      <AbsoluteFill style={{transform: `scale(${(t < 1 ? 0.92 + 0.08 * numberPop : 1) * (1 + creep * 0.04)})`}}>
        <TableWorld>
          <Tag at={T.zoomOut[1] - 0.1} x={SEATS.dev[0] - 210} y={SEATS.dev[1] + 10} color="#6B4FD8">
            היזם
          </Tag>
          <Tag at={T.zoomOut[1]} x={SEATS.sales[0] + 10} y={SEATS.sales[1] + 130} color="#2A8C6A">
            מכירות
          </Tag>
          <Tag at={T.zoomOut[1] + 0.1} x={SEATS.mkt[0] - 10} y={SEATS.mkt[1] + 130} color="#C2410C">
            שיווק
          </Tag>
          <Bubble at={5.4} x={630} y={290} w={430} tail="left" tone="dark" size={44}>
            רגע, וכמה מהם התקדמו?
          </Bubble>
          <Bubble at={7.5} x={24} y={700} w={380} tail="bottom-left">
            אני בודק…
          </Bubble>
          <Bubble at={8.9} x={580} y={700} w={476} tail="bottom-right">
            זה אצל המכירות
          </Bubble>
          <Bubble at={11.0} x={20} y={1170} w={320} tail="top-left" size={40}>
            יש לי אקסל אחר
          </Bubble>
        </TableWorld>
      </AbsoluteFill>
      {t < T.freeze + 0.05 && <Confetti />}
      {frozen && t < T.zoomOut[0] + 0.3 && <Confetti />}
      {/* the dry question over the frozen frame */}
      {frozen && (
        <AbsoluteFill style={{justifyContent: 'flex-start', paddingTop: 300, opacity: 1 - questionOut, background: `linear-gradient(180deg, rgba(11,22,38,${0.85 * ramp(frame, T.freeze, T.freeze + 0.3)}) 0%, rgba(11,22,38,0) 45%)`}}>
          <Line size={92} style={{alignSelf: 'center', background: 'rgba(11,22,38,0.82)', borderRadius: 40, padding: '28px 44px', boxShadow: '0 20px 60px rgba(0,0,0,0.45)'}}>
            <Word at={3.2}>אז</Word>
            <Word at={3.42}>למה</Word>
            <Word at={3.62}>אף</Word>
            <Word at={3.8}>אחד</Word>
            <br />
            <Word at={4.0}>לא</Word>
            <Word at={4.18} color={C.amber} glow="rgba(255,181,71,0.7)">
              מחייך?
            </Word>
          </Line>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// 12.6 – 15.9: room recedes, two-beat line
const TwoBeats = () => {
  const frame = useCurrentFrame();
  const r = ramp(frame, T.recede, T.recede + 0.7, 0, 1, ease);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{transform: `scale(${1.04 - 0.2 * r})`, filter: `blur(${r * 8}px) brightness(${1 - r * 0.6})`}}>
        <TableWorld zoomFrom={1} />
      </AbsoluteFill>
      <AbsoluteFill style={{background: `rgba(11,22,38,${0.55 * r})`}} />
      <AbsoluteFill style={{justifyContent: 'center', gap: 40, paddingBottom: 120}}>
        <Line size={62} weight={700}>
          <Word at={12.75}>אתם</Word>
          <Word at={12.95}>יודעים</Word>
          <Word at={13.25}>כמה</Word>
          <Word at={13.45}>לידים</Word>
          <Word at={13.8}>הגיעו.</Word>
        </Line>
        <Line size={118}>
          <Word at={14.55}>מה</Word>
          <Word at={14.72}>קרה</Word>
          <Word at={14.92}>להם</Word>
          <br />
          <Word at={15.15} color={C.brandLight} glow="rgba(49,92,245,0.9)">
            אחר
          </Word>
          <Word at={15.35} color={C.brandLight} glow="rgba(49,92,245,0.9)">
            כך?
          </Word>
        </Line>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 15.9 – 19.3: Tovno by Vitas; scattered cards line up right-to-left
const PATH = [
  {label: 'פרסום', icon: '📣', v: '₪62K'},
  {label: 'לידים', icon: '👥', v: '247'},
  {label: 'פגישות', icon: '📅', v: '64'},
  {label: 'עסקאות', icon: '🤝', v: '9'},
];
const Brand = () => {
  const frame = useCurrentFrame();
  const logo = useSpring(T.logo, {damping: 12});
  const a = ramp(frame, T.arrange, T.arrange + 0.75, 0, 1, Easing.inOut(Easing.back(1.2)));
  const line = ramp(frame, T.arrange + 0.7, T.arrange + 1.6, 0, 1, ease);
  const cardW = 214;
  const gap = 44;
  const rowW = PATH.length * cardW + (PATH.length - 1) * gap;
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 50% 35%, #213C78 0%, ${C.deep} 70%)`}}>
      <AbsoluteFill style={{alignItems: 'center', paddingTop: 360}}>
        <div style={{transform: `scale(${0.6 + 0.4 * logo})`, opacity: Math.min(1, logo * 1.5), filter: 'drop-shadow(0 0 40px rgba(49,92,245,0.7))'}}>
          <Img src={staticFile('tovno-logo-white.svg')} style={{width: 640}} />
        </div>
        <div style={{marginTop: 40, opacity: ramp(frame, 17.3, 17.7)}}>
          <Line size={58} weight={700}>
            <Word at={17.3}>מהפרסום</Word>
            <Word at={17.95} color={C.muted}>—</Word>
            <Word at={18.15}>עד</Word>
            <Word at={18.35} color={C.success} glow="rgba(47,208,138,0.7)">
              העסקה
            </Word>
          </Line>
        </div>
      </AbsoluteFill>
      {/* connecting line, drawn right → left */}
      <div
        style={{
          position: 'absolute',
          top: 1205,
          right: (1080 - rowW) / 2 + cardW / 2,
          width: (rowW - cardW) * line,
          height: 6,
          borderRadius: 3,
          background: `linear-gradient(270deg, ${C.brandLight}, ${C.success})`,
          boxShadow: `0 0 20px ${C.brand}`,
        }}
      />
      {PATH.map((p, i) => {
        // i = 0 is rightmost (RTL reading order)
        const fx = 1080 - (1080 - rowW) / 2 - cardW / 2 - i * (cardW + gap);
        const fy = 1205;
        const sx = 160 + random(`bx${i}`) * 760;
        const sy = 1000 + random(`by${i}`) * 520;
        const sr = (random(`br${i}`) - 0.5) * 50;
        const appear = useSpring(T.logo + 0.15 + i * 0.1, {damping: 12, mass: 0.6});
        const x = sx + (fx - sx) * a;
        const y = sy + (fy - sy) * a;
        return (
          <div
            key={p.label}
            style={{
              position: 'absolute',
              left: x - cardW / 2,
              top: y - 110,
              width: cardW,
              height: 220,
              borderRadius: 26,
              background: '#fff',
              boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
              transform: `rotate(${sr * (1 - a)}deg) scale(${appear})`,
              fontFamily: font,
              direction: 'rtl',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            <div style={{fontSize: 46}}>{p.icon}</div>
            <div style={{fontSize: 40, fontWeight: 900, color: i === 3 ? '#08744A' : C.brand, direction: 'ltr'}}>{p.v}</div>
            <div style={{fontSize: 30, fontWeight: 800, color: C.navy}}>{p.label}</div>
          </div>
        );
      })}
      {PATH.slice(0, 3).map((_, i) => {
        const x = 1080 - (1080 - rowW) / 2 - cardW - gap / 2 - i * (cardW + gap);
        return (
          <div key={i} style={{position: 'absolute', left: x - 18, top: 1180, fontSize: 40, color: '#fff', fontWeight: 900, opacity: line > (i + 1) / 3 - 0.1 ? 1 : 0}}>
            ←
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// 19.3 – 24.0: one look at the product, three focus areas
const UI_W = 965;
const UI_H = 820;
const FOCUS = [
  {q: 'מה מביא פגישות?', box: [0, 48, 965, 200]},
  {q: 'איפה לידים נתקעים?', box: [0, 255, 965, 280]},
  {q: 'ומה הופך לעסקאות?', box: [0, 545, 965, 275]},
];
const Glimpse = () => {
  const frame = useCurrentFrame();
  const t = frame / M_FPS;
  const inP = useSpring(T.glimpse, {damping: 16, mass: 0.9});
  const scale = 1010 / UI_W;
  const idx = t < T.focus[0] ? -1 : t < T.focus[1] ? 0 : t < T.focus[2] ? 1 : 2;
  const cur = FOCUS[Math.max(0, idx)];
  const prev = FOCUS[Math.max(0, idx - 1)];
  const since = idx >= 0 ? t - T.focus[idx] : 0;
  const m = Math.min(1, since / 0.35);
  const mm = Easing.inOut(Easing.cubic)(m);
  const box = idx <= 0 ? cur.box : prev.box.map((v, k) => v + (cur.box[k] - v) * mm);
  const dim = idx < 0 ? 0 : Math.min(1, (t - T.focus[0]) / 0.3);
  const winTop = 600;
  // gentle push toward the focused area
  const zoom = 1 + 0.06 * dim;
  const cy = (box[1] + box[3] / 2) * scale;
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 50% 30%, #1E3770 0%, ${C.deep} 75%)`}}>
      {/* question */}
      <AbsoluteFill style={{justifyContent: 'flex-start', paddingTop: 300}}>
        {idx >= 0 && (
          <div key={idx}>
            <Line size={92}>
              <Word at={T.focus[idx]} color="#fff">
                {cur.q}
              </Word>
            </Line>
          </div>
        )}
      </AbsoluteFill>
      {/* product window */}
      <div
        style={{
          position: 'absolute',
          left: 35,
          top: winTop,
          width: 1010,
          transform: `translateY(${(1 - inP) * 1200}px) scale(${zoom})`,
          transformOrigin: `50% ${cy + 56}px`,
          borderRadius: 28,
          overflow: 'hidden',
          background: '#fff',
          boxShadow: '0 40px 100px rgba(0,0,0,0.55), 0 0 0 2px rgba(255,255,255,0.1)',
        }}
      >
        <div style={{height: 56, background: '#EEF2F8', display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px', direction: 'ltr'}}>
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
            <div key={c} style={{width: 16, height: 16, borderRadius: 8, background: c}} />
          ))}
          <div style={{flex: 1, height: 30, marginLeft: 20, borderRadius: 15, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: font, fontSize: 18, color: C.text2}}>
            tovno · מקורות הגעה
          </div>
        </div>
        <div style={{position: 'relative', width: 1010, height: UI_H * scale}}>
          <Img src={staticFile('v3/ui.png')} style={{width: 1010, height: UI_H * scale, display: 'block'}} />
          {/* spotlight */}
          {dim > 0 && (
            <div
              style={{
                position: 'absolute',
                left: box[0] * scale + 6,
                top: box[1] * scale,
                width: box[2] * scale - 12,
                height: box[3] * scale,
                borderRadius: 18,
                boxShadow: `0 0 0 3000px rgba(11,22,38,${0.62 * dim}), 0 0 0 4px ${C.brand}, 0 0 40px rgba(49,92,245,0.8)`,
              }}
            />
          )}
        </div>
      </div>
      <div style={{position: 'absolute', bottom: 470, width: '100%', textAlign: 'center', fontFamily: font, fontSize: 24, color: C.muted, opacity: 0.8 * inP}}>
        * נתונים להמחשה
      </div>
    </AbsoluteFill>
  );
};

// 24.0 – 26.4: back at the table — one clear picture, a new question
const Clear = () => {
  const frame = useCurrentFrame();
  const push = ramp(frame, T.backToTable, T.cta, 0, 1, Easing.inOut(Easing.quad));
  return (
    <AbsoluteFill style={{transform: `scale(${1 + push * 0.14})`, transformOrigin: `${CARD.x}px ${CARD.y - 200}px`}}>
      <TableWorld organized zoomFrom={1} cardScale={1.3 + 0.1 * push}>
        <Tag at={T.backToTable + 0.1} x={SEATS.dev[0] - 210} y={SEATS.dev[1] + 10} color="#6B4FD8">
          היזם
        </Tag>
        <Tag at={T.backToTable + 0.15} x={SEATS.sales[0] + 10} y={SEATS.sales[1] + 130} color="#2A8C6A">
          מכירות
        </Tag>
        <Tag at={T.backToTable + 0.2} x={SEATS.mkt[0] - 10} y={SEATS.mkt[1] + 130} color="#C2410C">
          שיווק
        </Tag>
        <Bubble at={24.2} x={630} y={290} w={430} tail="left" tone="dark" size={44}>
          אוקיי. אז מה עושים עכשיו?
        </Bubble>
      </TableWorld>
    </AbsoluteFill>
  );
};

// 26.4 – 31: logo, line, CTA — held still for reading
const Cta = () => {
  const frame = useCurrentFrame();
  const logo = useSpring(T.cta + 0.1, {damping: 13});
  const btn = useSpring(T.button, {damping: 10, mass: 0.6});
  const shine = ((frame - f(T.button)) % 50) / 50;
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 50% 38%, #213C78 0%, ${C.deep} 72%)`}}>
      <AbsoluteFill style={{alignItems: 'center', paddingTop: 470}}>
        <div style={{transform: `scale(${0.7 + 0.3 * logo})`, opacity: Math.min(1, logo * 1.5), filter: 'drop-shadow(0 0 40px rgba(49,92,245,0.7))'}}>
          <Img src={staticFile('tovno-logo-white.svg')} style={{width: 720}} />
        </div>
        <div style={{marginTop: 60}}>
          <Line size={78}>
            <Word at={27.25}>להבין</Word>
            <Word at={27.55}>מה</Word>
            <Word at={27.75} color={C.brandLight}>
              עובד.
            </Word>
          </Line>
          <Line size={78} style={{marginTop: 10}}>
            <Word at={28.5}>לדעת</Word>
            <Word at={28.85}>מה</Word>
            <Word at={29.05} color={C.success} glow="rgba(47,208,138,0.6)">
              לקדם.
            </Word>
          </Line>
        </div>
        <div
          style={{
            marginTop: 70,
            position: 'relative',
            overflow: 'hidden',
            opacity: frame >= f(T.button) ? 1 : 0,
            transform: `scale(${btn})`,
            background: `linear-gradient(180deg, #4A72FF, ${C.brand})`,
            color: '#fff',
            fontFamily: font,
            fontWeight: 900,
            fontSize: 62,
            padding: '26px 90px',
            borderRadius: 999,
            boxShadow: '0 0 50px rgba(49,92,245,0.85), inset 0 2px 0 rgba(255,255,255,0.4)',
            direction: 'rtl',
          }}
        >
          לתיאום הדגמה
          <div style={{position: 'absolute', top: 0, bottom: 0, width: 110, left: `${shine * 170 - 35}%`, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)', transform: 'skewX(-20deg)'}} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Window = ({from, to, children, fadeIn = 0.2}) => {
  const frame = useCurrentFrame();
  if (frame < f(from) || frame >= f(to)) return null;
  const o = fadeIn > 0 ? interpolate(frame, [f(from), f(from + fadeIn)], [0, 1], CL) : 1;
  return <AbsoluteFill style={{opacity: o}}>{children}</AbsoluteFill>;
};

export const Meeting = () => {
  const musicA = (fr) => interpolate(fr / M_FPS, [0, 0.2, 2.85, 3.0], [0, 0.3, 0.3, 0], CL);
  // music B starts at 12.75, offset so the track is 3s into its groove by the logo
  const musicB = (fr) => {
    const t = 12.75 + fr / M_FPS;
    return interpolate(t, [12.75, 15.6, 16.0, 24.0, 24.6, 26.4, 30.2, 31], [0.05, 0.12, 0.2, 0.2, 0.3, 0.3, 0.3, 0], CL);
  };
  return (
    <AbsoluteFill style={{background: C.deep, overflow: 'hidden'}}>
      <Window from={0} to={T.recede} fadeIn={0}>
        <Room />
      </Window>
      <Window from={T.recede} to={T.logo} fadeIn={0}>
        <TwoBeats />
      </Window>
      <Window from={T.logo} to={T.glimpse}>
        <Brand />
      </Window>
      <Window from={T.glimpse} to={T.backToTable}>
        <Glimpse />
      </Window>
      <Window from={T.backToTable} to={T.cta}>
        <Clear />
      </Window>
      <Window from={T.cta} to={31}>
        <Cta />
      </Window>
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,0.5) 100%)', pointerEvents: 'none'}} />
      <Grain />
      {VO.map(([file, at]) => (
        <Sequence key={file} from={f(at)} layout="none">
          <Audio src={staticFile(`v3/vo/${file}.mp3`)} />
        </Sequence>
      ))}
      <Audio src={staticFile('v3/music-a.mp3')} volume={musicA} />
      <Sequence from={f(12.75)} layout="none">
        <Audio src={staticFile('v3/music-b.mp3')} volume={musicB} />
      </Sequence>
      {SFX.map(([at, file, vol], i) => (
        <Sequence key={i} from={f(at)} layout="none">
          <Audio src={staticFile(`${file}.mp3`)} volume={vol} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
