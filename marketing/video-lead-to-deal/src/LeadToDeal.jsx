import '@fontsource/heebo/400.css';
import '@fontsource/heebo/500.css';
import '@fontsource/heebo/700.css';
import '@fontsource/heebo/800.css';
import '@fontsource/heebo/900.css';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';
import {VO, SFX, HITS, CUTS} from './timeline';

export const FPS = 30;
export const DURATION = 30 * FPS;
const WIDTH = 1080;
const MUSIC_IN = 13.18 - 1.5; // track build starts 1.5s before its hit at 24.0

const C = {
  brand: '#315CF5',
  brandLight: '#8FA9FF',
  navy: '#14243C',
  deep: '#070D18',
  text2: '#52627A',
  muted: '#B7C4DA',
  success: '#2FD08A',
  successDark: '#08744A',
  danger: '#FF5A36',
  amber: '#FFB547',
};
const font = 'Heebo, sans-serif';
const CL = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'};
const f = (sec) => Math.round(sec * FPS);

const useSpring = (atSec, config = {damping: 14, mass: 0.7}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - f(atSec), fps, config});
};
const ramp = (frame, a, b, from = 0, to = 1, easing = Easing.out(Easing.cubic)) =>
  interpolate(frame, [f(a), f(b)], [from, to], {...CL, easing});

/* ───────────── shared FX ───────────── */

const SvgDefs = () => (
  <svg width="0" height="0" style={{position: 'absolute'}}>
    <defs>
      <filter id="ch-r"><feColorMatrix values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" /></filter>
      <filter id="ch-g"><feColorMatrix values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" /></filter>
      <filter id="ch-b"><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" /></filter>
    </defs>
  </svg>
);

// RGB split + horizontal slice displacement. Works on dark backgrounds (screen blend).
const Glitch = ({amount, children}) => {
  const frame = useCurrentFrame();
  if (amount <= 0.01) return <AbsoluteFill>{children}</AbsoluteFill>;
  const off = amount * 22;
  const slices = [0, 1, 2, 3].map((i) => {
    const top = random(`gt${i}-${Math.floor(frame / 2)}`) * 90;
    const h = 2 + random(`gh${i}-${Math.floor(frame / 2)}`) * 8;
    const dx = (random(`gx${i}-${frame}`) - 0.5) * 160 * amount;
    return {top, h, dx};
  });
  return (
    <AbsoluteFill style={{background: C.deep}}>
      {[
        ['ch-r', -off],
        ['ch-g', 0],
        ['ch-b', off],
      ].map(([id, dx]) => (
        <AbsoluteFill key={id} style={{filter: `url(#${id})`, mixBlendMode: 'screen', transform: `translateX(${dx}px)`}}>
          {children}
        </AbsoluteFill>
      ))}
      {slices.map((s, i) => (
        <AbsoluteFill
          key={i}
          style={{clipPath: `inset(${s.top}% 0 ${100 - s.top - s.h}% 0)`, transform: `translateX(${s.dx}px)`}}
        >
          {children}
        </AbsoluteFill>
      ))}
    </AbsoluteFill>
  );
};

const Grain = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{mixBlendMode: 'overlay', opacity: 0.16, pointerEvents: 'none'}}>
      <svg width="100%" height="100%">
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={frame % 12} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  );
};

const Vignette = () => (
  <AbsoluteFill style={{background: 'radial-gradient(ellipse at 50% 45%, transparent 45%, rgba(0,0,0,0.65) 100%)', pointerEvents: 'none'}} />
);

const LightLeak = ({opacity = 0.35}) => {
  const frame = useCurrentFrame();
  const x1 = 30 + Math.sin(frame / 50) * 25;
  const y1 = 25 + Math.cos(frame / 70) * 15;
  const x2 = 75 + Math.cos(frame / 45) * 20;
  const y2 = 80 + Math.sin(frame / 60) * 10;
  return (
    <AbsoluteFill
      style={{
        mixBlendMode: 'screen',
        opacity,
        background: `radial-gradient(circle at ${x1}% ${y1}%, rgba(49,92,245,0.55), transparent 40%), radial-gradient(circle at ${x2}% ${y2}%, rgba(255,181,71,0.35), transparent 35%)`,
        pointerEvents: 'none',
      }}
    />
  );
};

// Decaying camera shake from every hit.
const useShake = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  let amp = 0;
  for (const [at, strength] of HITS) {
    if (t >= at) amp += Math.max(0, 1 - (t - at) / 0.4) * strength;
  }
  return {
    x: (random(`sx${frame}`) - 0.5) * 2 * amp * 26,
    y: (random(`sy${frame}`) - 0.5) * 2 * amp * 26,
    r: (random(`sr${frame}`) - 0.5) * amp * 1.2,
  };
};

const Flash = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  let o = 0;
  for (const [at, strength] of HITS) {
    if (t >= at - 0.03) o = Math.max(o, Math.max(0, 1 - (t - at) / 0.25) * strength * 0.55);
  }
  // big white-out into the reveal
  o = Math.max(o, interpolate(frame, [f(12.95), f(13.18), f(13.6)], [0, 1, 0], CL));
  return <AbsoluteFill style={{background: '#fff', opacity: o, pointerEvents: 'none'}} />;
};

// Scene window with whip-pan in/out (motion-blurred slide).
const Scene = ({from, to, children, whipIn = 0, whipOut = 0}) => {
  const frame = useCurrentFrame();
  if (frame < f(from) || frame >= f(to)) return null;
  const inP = whipIn ? interpolate(frame, [f(from), f(from) + 7], [1, 0], {...CL, easing: Easing.out(Easing.cubic)}) : 0;
  const outP = whipOut ? interpolate(frame, [f(to) - 6, f(to)], [0, 1], {...CL, easing: Easing.in(Easing.cubic)}) : 0;
  const x = inP * whipIn * WIDTH * 0.9 - outP * whipOut * WIDTH * 0.9;
  const blur = (inP + outP) * 40;
  return (
    <AbsoluteFill style={{transform: `translateX(${x}px)`, filter: blur > 0.5 ? `blur(${blur}px)` : undefined}}>
      {children}
    </AbsoluteFill>
  );
};

// Footage with slow push-in and grade.
const Footage = ({src, from, dur, rate = 1, startAt = 0, zoom = [1.08, 1.2], grade = 0.45, blur = 0}) => {
  const frame = useCurrentFrame();
  const z = interpolate(frame, [f(from), f(from + dur)], zoom, CL);
  return (
    <Sequence from={f(from)} durationInFrames={f(dur)} layout="none">
      <AbsoluteFill style={{transform: `scale(${z})`, filter: blur ? `blur(${blur}px)` : undefined}}>
        <OffthreadVideo src={staticFile(src)} muted playbackRate={rate} startFrom={f(startAt)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
      </AbsoluteFill>
      <AbsoluteFill style={{background: `linear-gradient(180deg, rgba(7,13,24,${grade * 0.7}) 0%, rgba(7,13,24,${grade}) 55%, rgba(7,13,24,${Math.min(1, grade + 0.35)}) 100%)`}} />
    </Sequence>
  );
};

const Word = ({children, at, color = '#fff', glow}) => {
  const frame = useCurrentFrame();
  const p = useSpring(at, {damping: 12, mass: 0.6});
  const o = interpolate(frame, [f(at), f(at) + 3], [0, 1], CL);
  return (
    <span
      style={{
        display: 'inline-block',
        opacity: o,
        color,
        transform: `translateY(${(1 - p) * 50}px) scale(${0.55 + 0.45 * p})`,
        filter: `blur(${Math.max(0, 1 - p) * 14}px)`,
        textShadow: glow ? `0 0 40px ${glow}` : '0 6px 30px rgba(0,0,0,0.5)',
        margin: '0 0.11em',
      }}
    >
      {children}
    </span>
  );
};

const Line = ({children, size = 96, style}) => (
  <div style={{direction: 'rtl', fontFamily: font, fontWeight: 900, fontSize: size, lineHeight: 1.08, textAlign: 'center', letterSpacing: -1, ...style}}>
    {children}
  </div>
);

const Count = ({to, at, dur = 0.7, prefix = '₪'}) => {
  const frame = useCurrentFrame();
  const v = ramp(frame, at, at + dur, 0, to, Easing.out(Easing.quad));
  return <span style={{fontVariantNumeric: 'tabular-nums'}}>{prefix}{Math.round(v).toLocaleString('en-US')}</span>;
};

/* ───────────── 1. HOOK  0 – 1.8 ───────────── */

const Hook = () => {
  const frame = useCurrentFrame();
  const tag = useSpring(VO.lead, {damping: 9, mass: 0.5});
  const ring = ramp(frame, 0.35, 1.2);
  return (
    <AbsoluteFill>
      <Footage src="footage/phone.mp4" from={0} dur={1.9} zoom={[1.15, 1.3]} grade={0.35} />
      {/* tap ripple */}
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <div style={{width: 120 + ring * 700, height: 120 + ring * 700, borderRadius: '50%', border: `4px solid rgba(143,169,255,${0.8 * (1 - ring)})`, boxShadow: `0 0 60px rgba(49,92,245,${0.6 * (1 - ring)})`}} />
      </AbsoluteFill>
      <AbsoluteFill style={{justifyContent: 'flex-start', paddingTop: 380}}>
        <Line size={108}>
          <Word at={0.08}>אתם</Word>
          <Word at={0.3}>יודעים</Word>
          <Word at={0.56}>כמה</Word>
          <br />
          <Word at={0.8}>עולה</Word>
          <Word at={VO.lead} color={C.brandLight} glow="rgba(49,92,245,0.9)">ליד.</Word>
        </Line>
      </AbsoluteFill>
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', paddingTop: 520}}>
        <div
          style={{
            opacity: frame >= f(VO.lead) ? 1 : 0,
            transform: `scale(${2.4 - 1.4 * tag}) rotate(${(1 - tag) * -8}deg)`,
            fontFamily: font,
            fontWeight: 900,
            fontSize: 210,
            color: '#fff',
            textShadow: `0 0 50px ${C.success}, 0 0 120px rgba(47,208,138,0.6)`,
            direction: 'ltr',
          }}
        >
          <Count to={142} at={VO.lead} dur={0.45} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ───────────── 2. QUESTION  1.8 – 4.7 ───────────── */

const Question = () => {
  const frame = useCurrentFrame();
  const q = ramp(frame, 3.3, 4.3);
  const qScale = useSpring(3.32, {damping: 10, mass: 0.9});
  return (
    <AbsoluteFill>
      <Footage src="footage/tower.mp4" from={1.8} dur={3} zoom={[1.05, 1.22]} grade={0.4} />
      {/* giant outlined question mark drawn over the building */}
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <svg width="900" height="1200" viewBox="0 0 900 1200" style={{transform: `scale(${0.7 + 0.3 * qScale})`, opacity: frame > f(3.3) ? 1 : 0}}>
          <text
            x="450"
            y="1000"
            textAnchor="middle"
            fontFamily="Heebo"
            fontWeight="900"
            fontSize="1150"
            fill="none"
            stroke={C.brandLight}
            strokeWidth="6"
            strokeDasharray="5000"
            strokeDashoffset={5000 * (1 - q)}
            style={{filter: 'drop-shadow(0 0 30px rgba(49,92,245,0.9))'}}
          >
            ?
          </text>
        </svg>
      </AbsoluteFill>
      <AbsoluteFill style={{justifyContent: 'flex-start', paddingTop: 330}}>
        <Line size={70} style={{fontWeight: 700}}>
          <Word at={2.06}>אבל</Word>
          <Word at={2.28}>אתם</Word>
          <Word at={2.46}>יודעים</Word>
          <Word at={2.78}>כמה</Word>
          <Word at={3.0}>עלתה</Word>
        </Line>
        <Line size={128} style={{marginTop: 20}}>
          <Word at={3.32} color={C.amber} glow="rgba(255,181,71,0.7)">הדירה</Word>
          <br />
          <Word at={3.94} color={C.amber} glow="rgba(255,181,71,0.7)">שנמכרה?</Word>
        </Line>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ───────────── 3. SILOS  4.7 – 13.0 ───────────── */

const Panel = ({at, x, y, rotY, children, label, broken}) => {
  const frame = useCurrentFrame();
  const p = useSpring(at, {damping: 15, mass: 1});
  const idle = Math.sin((frame + x) / 18) * 10;
  const drift = broken * (x > 400 ? 1 : -1) * 70;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 660,
        opacity: Math.min(1, p * 1.5),
        transform: `translate3d(${drift}px, ${idle + broken * 30}px, ${(1 - p) * -1800}px) rotateY(${rotY + broken * rotY}deg) rotateX(8deg)`,
        transformStyle: 'preserve-3d',
      }}
    >
      <div
        style={{
          borderRadius: 28,
          padding: 28,
          background: 'linear-gradient(160deg, rgba(40,60,100,0.85), rgba(14,24,44,0.92))',
          border: `2px solid ${broken > 0.2 ? 'rgba(255,90,54,0.8)' : 'rgba(143,169,255,0.45)'}`,
          boxShadow: broken > 0.2 ? '0 0 60px rgba(255,90,54,0.45)' : '0 30px 90px rgba(0,0,0,0.6), 0 0 50px rgba(49,92,245,0.25)',
          fontFamily: font,
          direction: 'rtl',
          color: '#fff',
        }}
      >
        <div style={{fontSize: 40, fontWeight: 800, marginBottom: 18}}>{label}</div>
        {children}
      </div>
    </div>
  );
};

const AdsMock = () => {
  const frame = useCurrentFrame();
  const bars = [0.4, 0.65, 0.5, 0.85, 0.7, 0.95, 0.8];
  return (
    <div>
      <div style={{display: 'flex', gap: 14, alignItems: 'flex-end', height: 130}}>
        {bars.map((b, i) => (
          <div key={i} style={{flex: 1, height: `${b * 100 * ramp(frame, 5.0 + i * 0.05, 5.6 + i * 0.05)}%`, borderRadius: 8, background: `linear-gradient(0deg, ${C.brand}, ${C.brandLight})`}} />
        ))}
      </div>
      <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 18, fontSize: 28, color: C.muted}}>
        <span>קליקים <b style={{color: '#fff'}}>48.2K</b></span>
        <span>עלות לליד <b style={{color: C.success}}>₪142</b></span>
      </div>
    </div>
  );
};

const CrmMock = () => {
  const rows = [
    ['ד״כ', 'חדש', C.brandLight],
    ['מ״ל', 'בטיפול', C.amber],
    ['ע״ש', 'לא ענה', C.danger],
    ['י״ב', 'חדש', C.brandLight],
  ];
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
      {rows.map(([n, s, c], i) => (
        <div key={i} style={{display: 'flex', alignItems: 'center', gap: 16, fontSize: 28}}>
          <div style={{width: 48, height: 48, borderRadius: 24, background: 'rgba(255,255,255,0.15)', display: 'grid', placeItems: 'center', fontSize: 20, fontWeight: 700}}>{n}</div>
          <div style={{flex: 1, height: 14, borderRadius: 7, background: 'rgba(255,255,255,0.18)'}} />
          <div style={{padding: '4px 16px', borderRadius: 20, border: `2px solid ${c}`, color: c, fontWeight: 700, fontSize: 24}}>{s}</div>
        </div>
      ))}
    </div>
  );
};

const SheetMock = () => {
  const cells = ['פגישה', '12/9', '?', 'עסקה', '#N/A', '₪?', 'מקור', '—', '#N/A'];
  return (
    <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, background: 'rgba(255,255,255,0.2)', padding: 4, borderRadius: 10}}>
      {cells.map((c, i) => (
        <div key={i} style={{background: i < 3 ? '#1E7145' : 'rgba(10,20,36,0.9)', padding: '12px 10px', fontSize: 28, fontWeight: 700, textAlign: 'center', direction: /[A-Za-z]/.test(c) ? 'ltr' : 'rtl', color: c.includes('N/A') || c.includes('?') ? C.danger : '#fff'}}>
          {c}
        </div>
      ))}
    </div>
  );
};

const Silos = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const tryConnect = ramp(frame, VO.connectTry, VO.snap);
  const snapped = t >= VO.snap;
  const broken = ramp(frame, VO.snap, VO.snap + 0.6);
  const glitch =
    interpolate(frame, [f(4.7), f(4.95)], [1, 0], CL) +
    interpolate(frame, [f(VO.snap), f(VO.snap) + 3, f(VO.snap + 0.5)], [0, 1, 0], CL) +
    (t > 12.4 && t < 13 ? random(`g${frame}`) * 0.6 : 0);
  // camera slowly dollies back
  const camZ = interpolate(frame, [f(4.7), f(13)], [-30, -170], CL);
  const pts = [
    [500, 470],
    [580, 860],
    [500, 1250],
  ];
  const path = `M ${pts[0][0]} ${pts[0][1]} C 820 600, 820 740, ${pts[1][0]} ${pts[1][1]} S 180 1120, ${pts[2][0]} ${pts[2][1]}`;
  return (
    <Glitch amount={Math.min(1, glitch)}>
      <AbsoluteFill style={{background: `radial-gradient(circle at 50% 40%, #1A2C52 0%, ${C.deep} 70%)`}} />
      {/* perspective grid floor */}
      <AbsoluteFill style={{perspective: 900, overflow: 'hidden'}}>
        <div
          style={{
            position: 'absolute',
            left: -1000,
            right: -1000,
            top: 1150,
            height: 1600,
            transform: 'rotateX(72deg)',
            transformOrigin: 'top',
            backgroundImage: 'linear-gradient(rgba(143,169,255,0.25) 2px, transparent 2px), linear-gradient(90deg, rgba(143,169,255,0.25) 2px, transparent 2px)',
            backgroundSize: '120px 120px',
            backgroundPositionY: frame * 4,
            maskImage: 'linear-gradient(180deg, black, transparent 70%)',
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{perspective: 1600}}>
        <AbsoluteFill style={{transformStyle: 'preserve-3d', transform: `translateZ(${camZ}px)`}}>
          <Panel at={VO.ads} x={30} y={250} rotY={16} label="📣  פרסום · מטא וגוגל" broken={broken}>
            <AdsMock />
          </Panel>
          <Panel at={VO.crm} x={390} y={680} rotY={-16} label="🗂️  לידים · CRM" broken={broken}>
            <CrmMock />
          </Panel>
          <Panel at={VO.excel} x={30} y={1090} rotY={16} label="📊  פגישות ועסקאות · אקסל" broken={broken}>
            <SheetMock />
          </Panel>
        </AbsoluteFill>
      </AbsoluteFill>
      {/* the thread that fails to connect them */}
      <AbsoluteFill>
        <svg width="1080" height="1920">
          <path
            d={path}
            fill="none"
            stroke={snapped ? C.danger : C.brandLight}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={snapped ? '520 120 2000' : '2000'}
            strokeDashoffset={snapped ? 0 : 2000 * (1 - tryConnect)}
            opacity={snapped ? 1 - broken * 0.6 : tryConnect > 0 ? 1 : 0}
            style={{filter: `drop-shadow(0 0 18px ${snapped ? C.danger : C.brand})`}}
          />
          {snapped &&
            Array.from({length: 18}).map((_, i) => {
              const a = random(`sp${i}`) * Math.PI * 2;
              const d = broken * (80 + random(`sd${i}`) * 260);
              return <circle key={i} cx={560 + Math.cos(a) * d} cy={700 + Math.sin(a) * d + broken * 120} r={6 * (1 - broken) + 1} fill={C.amber} opacity={1 - broken} />;
            })}
        </svg>
      </AbsoluteFill>
      <AbsoluteFill style={{justifyContent: 'flex-end', paddingBottom: 470}}>
        <Line size={84} style={{color: '#fff'}}>
          <Word at={11.12} color={C.danger} glow="rgba(255,90,54,0.8)">ואף</Word>
          <Word at={11.5} color={C.danger} glow="rgba(255,90,54,0.8)">אחד</Word>
          <Word at={11.8}>לא</Word>
          <Word at={11.94}>מחבר</Word>
          <Word at={12.36}>ביניהם.</Word>
        </Line>
      </AbsoluteFill>
    </Glitch>
  );
};

/* ───────────── 4. CONNECT  13.0 – 20.0 ───────────── */

const ICONS = {
  click: 'M30 18 L30 72 L44 60 L54 82 L64 77 L54 56 L72 56 Z',
  lead: 'M50 22 a14 14 0 1 1 -0.1 0 Z M24 80 C24 60 76 60 76 80 Z',
  meet: 'M22 30 h56 v48 h-56 Z M22 42 h56 M36 22 v14 M64 22 v14',
  deal: 'M28 18 h34 l14 14 v50 h-48 Z M38 56 l9 9 l17 -19',
};

const NODES = [
  {key: 'click', label: 'קליק', stat: '48,200', at: 15.6, x: 300, y: 560},
  {key: 'lead', label: 'ליד', stat: '1,260', at: 16.25, x: 780, y: 820},
  {key: 'meet', label: 'פגישה במשרד המכירות', stat: '186', at: 16.98, x: 300, y: 1080},
  {key: 'deal', label: 'חוזה חתום', stat: '22', at: 18.94, x: 780, y: 1340},
];

const JourneyNode = ({n, last}) => {
  const frame = useCurrentFrame();
  const p = useSpring(n.at, {damping: 9, mass: 0.6});
  const pulse = frame > f(n.at) ? 1 + Math.sin((frame - f(n.at)) / 5) * 0.04 : 1;
  const color = last ? C.success : C.brand;
  const ring = ramp(frame, n.at, n.at + 0.6);
  return (
    <div style={{position: 'absolute', left: n.x - 90, top: n.y - 90, width: 180, height: 180, opacity: frame >= f(n.at) ? 1 : 0}}>
      <div style={{position: 'absolute', inset: -ring * 90, borderRadius: '50%', border: `3px solid ${color}`, opacity: 1 - ring}} />
      <div
        style={{
          width: 180,
          height: 180,
          borderRadius: '50%',
          transform: `scale(${p * pulse})`,
          background: `radial-gradient(circle at 35% 30%, ${last ? '#6BF0B4' : '#6E8CFF'}, ${color} 60%, ${last ? '#065A3A' : '#1D3BB8'})`,
          boxShadow: `0 0 70px ${color}, inset 0 0 30px rgba(255,255,255,0.35)`,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <svg width="100" height="100" viewBox="0 0 100 100">
          <path d={ICONS[n.key]} fill={n.key === 'click' || n.key === 'lead' ? '#fff' : 'none'} stroke="#fff" strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 190,
          left: -160,
          width: 500,
          textAlign: 'center',
          fontFamily: font,
          direction: 'rtl',
          color: '#fff',
          opacity: ramp(frame, n.at + 0.1, n.at + 0.4),
          transform: `translateY(${(1 - ramp(frame, n.at + 0.1, n.at + 0.4)) * 20}px)`,
        }}
      >
        <div style={{fontSize: 40, fontWeight: 800, textShadow: '0 4px 20px rgba(0,0,0,0.8)'}}>{n.label}</div>
        <div style={{fontSize: 34, fontWeight: 600, color: last ? C.success : C.brandLight, direction: 'ltr'}}>{n.stat}</div>
      </div>
    </div>
  );
};

const Connect = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / FPS;
  // particles converge into the logo
  const conv = ramp(frame, 12.95, 13.45, 0, 1, Easing.inOut(Easing.cubic));
  const logoIn = spring({frame: frame - f(13.18), fps, config: {damping: 12}});
  const logoUp = ramp(frame, 15.1, 15.6, 0, 1, Easing.inOut(Easing.cubic));
  // journey path
  const seg = (i) => ramp(frame, NODES[i].at, NODES[i + 1].at - 0.05, 0, 1, Easing.inOut(Easing.quad));
  const pathD = NODES.map((n, i) => (i === 0 ? `M ${n.x} ${n.y}` : `C ${NODES[i - 1].x} ${NODES[i - 1].y + 180}, ${n.x} ${n.y - 180}, ${n.x} ${n.y}`)).join(' ');
  const total = (t < NODES[0].at ? 0 : seg(0) + seg(1) + seg(2)) / 3;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{background: `radial-gradient(circle at 50% 45%, #1C3366 0%, ${C.deep} 75%)`}} />
      <Footage src="footage/gallery.mp4" from={16.6} dur={2.5} zoom={[1.1, 1.25]} grade={0.62} blur={2} />
      <Footage src="footage/contract.mp4" from={18.9} dur={1.15} zoom={[1.1, 1.18]} grade={0.55} blur={1} />
      <LightLeak opacity={0.5} />
      {/* particles */}
      {Array.from({length: 60}).map((_, i) => {
        const sx = random(`px${i}`) * 1080;
        const sy = random(`py${i}`) * 1920 - (frame % 400) * (0.5 + random(`pv${i}`));
        const tx = 540 + (random(`tx${i}`) - 0.5) * 520;
        const ty = 900 + (random(`ty${i}`) - 0.5) * 160;
        const x = sx + (tx - sx) * conv;
        const y = sy + (ty - sy) * conv;
        const o = t < 13.6 ? 0.9 : 0.35;
        return <div key={i} style={{position: 'absolute', left: x, top: ((y % 1920) + 1920) % 1920, width: 6, height: 6, borderRadius: 3, background: i % 3 ? C.brandLight : '#fff', boxShadow: `0 0 12px ${C.brand}`, opacity: o}} />;
      })}
      {/* logo */}
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <div
          style={{
            transform: `translateY(${-560 * logoUp}px) scale(${(0.5 + 0.5 * logoIn) * (1 - 0.45 * logoUp)})`,
            opacity: t >= 13.18 ? 1 : 0,
            filter: `drop-shadow(0 0 ${40 - 25 * logoUp}px rgba(49,92,245,0.9))`,
          }}
        >
          <Img src={staticFile('tovno-logo-white.svg')} style={{width: 760}} />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{justifyContent: 'center', paddingTop: 420, opacity: 1 - logoUp}}>
        <Line size={72} style={{fontWeight: 800}}>
          <Word at={13.46}>מחברת</Word>
          <Word at={13.9}>הכול</Word>
          <Word at={14.28} color={C.brandLight} glow="rgba(49,92,245,0.9)">לדשבורד</Word>
          <Word at={14.88} color={C.brandLight} glow="rgba(49,92,245,0.9)">אחד</Word>
        </Line>
      </AbsoluteFill>
      {/* glowing journey path */}
      <AbsoluteFill>
        <svg width="1080" height="1920">
          <path d={pathD} fill="none" stroke="rgba(143,169,255,0.15)" strokeWidth={6} strokeDasharray="10 14" opacity={t > 15.4 ? 1 : 0} />
          <path
            d={pathD}
            fill="none"
            stroke="url(#jg)"
            strokeWidth={10}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset={1 - total}
            style={{filter: 'drop-shadow(0 0 16px #315CF5) drop-shadow(0 0 30px #315CF5)'}}
          />
          <defs>
            <linearGradient id="jg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#8FA9FF" />
              <stop offset="0.7" stopColor="#315CF5" />
              <stop offset="1" stopColor="#2FD08A" />
            </linearGradient>
          </defs>
        </svg>
      </AbsoluteFill>
      {NODES.map((n, i) => (
        <JourneyNode key={n.key} n={n} last={i === NODES.length - 1} />
      ))}
    </AbsoluteFill>
  );
};

/* ───────────── 5. METRICS  20.0 – 23.4 ───────────── */

const CAMPAIGNS = [
  {name: 'מגדל הים · מטא', leads: 540, deals: 12, cpd: '₪6,100', good: true},
  {name: 'פנטהאוזים · גוגל', leads: 310, deals: 7, cpd: '₪7,900', good: true},
  {name: 'וידאו כללי · מטא', leads: 410, deals: 3, cpd: '₪19,400', good: false},
];

const Metrics = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const fly = useSpring(19.8, {damping: 16, mass: 1.1});
  const push = ramp(frame, 22.7, 23.4, 0, 1, Easing.inOut(Easing.cubic));
  const alert = t > VO.alert ? 0.5 + Math.sin((frame - f(VO.alert)) / 2.5) * 0.5 : 0;
  const kpi = (at) => ({
    s: spring({frame: frame - f(at), fps: FPS, config: {damping: 8, mass: 0.5}}),
  });
  const k1 = kpi(VO.perMeeting);
  const k2 = kpi(VO.perDeal);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{background: `radial-gradient(circle at 50% 30%, #203A74 0%, ${C.deep} 70%)`}} />
      <LightLeak opacity={0.4} />
      <AbsoluteFill style={{perspective: 1800}}>
        <div
          style={{
            position: 'absolute',
            left: 70,
            top: 330,
            width: 940,
            transformStyle: 'preserve-3d',
            transformOrigin: '50% 80%',
            transform: `translateZ(${(1 - fly) * -2200 + push * 380}px) translateY(${push * -120}px) rotateX(${14 - push * 8}deg) rotateY(${-10 + fly * 4}deg)`,
            fontFamily: font,
            direction: 'rtl',
          }}
        >
          <div style={{display: 'flex', gap: 26, marginBottom: 26}}>
            {[
              ['עלות לפגישה', 962, VO.perMeeting, k1, C.brandLight],
              ['עלות לעסקה', 8132, VO.perDeal, k2, C.success],
            ].map(([label, val, at, k, col]) => (
              <div
                key={label}
                style={{
                  flex: 1,
                  borderRadius: 30,
                  padding: '30px 34px',
                  background: 'linear-gradient(160deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04))',
                  border: '2px solid rgba(255,255,255,0.18)',
                  boxShadow: t >= at ? `0 0 ${60 * (1 - Math.min(1, (t - at) * 2)) + 20}px ${col}` : 'none',
                  opacity: t >= at - 0.05 ? 1 : 0.15,
                  transform: `scale(${t >= at ? 0.85 + 0.15 * k.s : 0.85})`,
                }}
              >
                <div style={{fontSize: 34, color: C.muted, fontWeight: 600}}>{label}</div>
                <div style={{fontSize: 96, fontWeight: 900, color: col, direction: 'ltr', textAlign: 'right', textShadow: `0 0 30px ${col}`}}>
                  {t >= at ? <Count to={val} at={at} dur={0.5} /> : '₪0'}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              borderRadius: 30,
              padding: '26px 34px',
              background: 'linear-gradient(160deg, rgba(255,255,255,0.12), rgba(255,255,255,0.03))',
              border: '2px solid rgba(255,255,255,0.16)',
              color: '#fff',
              opacity: ramp(frame, VO.perCampaign - 0.1, VO.perCampaign + 0.2),
            }}
          >
            <div style={{fontSize: 40, fontWeight: 800, marginBottom: 12}}>לכל קמפיין</div>
            {CAMPAIGNS.map((c, i) => {
              const at = VO.perCampaign + 0.1 + i * 0.12;
              const rowP = ramp(frame, at, at + 0.25);
              const bad = !c.good && t > VO.alert;
              return (
                <div
                  key={c.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: 34,
                    fontWeight: 600,
                    padding: '16px 14px',
                    margin: '0 -14px',
                    borderRadius: 16,
                    opacity: rowP,
                    transform: `translateX(${(1 - rowP) * -80}px)`,
                    background: bad ? `rgba(255,90,54,${0.15 + alert * 0.2})` : 'transparent',
                    boxShadow: bad ? `0 0 ${30 * alert}px rgba(255,90,54,0.8)` : 'none',
                  }}
                >
                  <span style={{flex: 2.3}}>{c.name}</span>
                  <span style={{flex: 1, color: C.muted}}>{c.leads}</span>
                  <span style={{flex: 0.8, color: C.muted}}>{c.deals}</span>
                  <span style={{flex: 1.3, fontWeight: 900, color: c.good ? C.success : C.danger, direction: 'ltr', textAlign: 'right'}}>{c.cpd}</span>
                </div>
              );
            })}
          </div>
          <div style={{fontSize: 24, color: C.muted, textAlign: 'center', marginTop: 18, opacity: 0.7}}>* נתונים להמחשה</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ───────────── 6. CTA  23.4 – 30 ───────────── */

const Cta = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const logo = useSpring(VO.brand2, {damping: 13});
  const sweep = ramp(frame, VO.brand2 + 0.1, VO.brand2 + 1.0, -0.4, 1.4, Easing.inOut(Easing.quad));
  const btn = useSpring(VO.demo, {damping: 9, mass: 0.6});
  const shine = ((frame - f(VO.demo)) % 45) / 45;
  const ring = ((frame - f(VO.demo)) % 30) / 30;
  const logoSrc = staticFile('tovno-logo-white.svg');
  return (
    <AbsoluteFill>
      <Footage src="footage/contract.mp4" from={23.4} dur={6.6} rate={0.45} startAt={2.0} zoom={[1.15, 1.35]} grade={0.55} />
      <LightLeak opacity={0.45} />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', paddingBottom: 380}}>
        <div style={{position: 'relative', width: 820, transform: `scale(${0.6 + 0.4 * logo})`, opacity: Math.min(1, logo * 1.4), filter: 'drop-shadow(0 0 40px rgba(49,92,245,0.8))'}}>
          <Img src={logoSrc} style={{width: 820, display: 'block'}} />
          {/* light sweep masked to the logo */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(105deg, transparent ${sweep * 100 - 12}%, rgba(255,255,255,0.95) ${sweep * 100}%, transparent ${sweep * 100 + 12}%)`,
              WebkitMaskImage: `url(${logoSrc})`,
              WebkitMaskSize: '100% 100%',
              maskImage: `url(${logoSrc})`,
              maskSize: '100% 100%',
            }}
          />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{justifyContent: 'center', paddingTop: 260}}>
        <Line size={112}>
          <Word at={24.4}>מליד</Word>
          <Word at={24.9} color={C.brandLight}>←</Word>
          <Word at={25.1}>ועד</Word>
          <Word at={25.38} color={C.success} glow="rgba(47,208,138,0.8)">עסקה</Word>
        </Line>
      </AbsoluteFill>
      <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 470}}>
        <div style={{position: 'relative', opacity: t >= VO.demo ? 1 : 0, transform: `scale(${btn})`}}>
          <div style={{position: 'absolute', inset: -ring * 40, borderRadius: 999, border: `3px solid rgba(143,169,255,${1 - ring})`}} />
          <div
            style={{
              position: 'relative',
              overflow: 'hidden',
              background: `linear-gradient(180deg, #4A72FF, ${C.brand})`,
              color: '#fff',
              fontFamily: font,
              fontSize: 66,
              fontWeight: 900,
              padding: '28px 96px',
              borderRadius: 999,
              boxShadow: '0 0 60px rgba(49,92,245,0.9), inset 0 2px 0 rgba(255,255,255,0.4)',
              direction: 'rtl',
            }}
          >
            בקשו הדגמה
            <div style={{position: 'absolute', top: 0, bottom: 0, width: 120, left: `${shine * 160 - 30}%`, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)', transform: 'skewX(-20deg)'}} />
          </div>
        </div>
        <div style={{marginTop: 34, fontFamily: font, fontSize: 38, fontWeight: 500, color: C.muted, direction: 'rtl', opacity: ramp(frame, VO.demo + 0.4, VO.demo + 0.9)}}>
          לחברות יזמות ולמנהלות שיווק בנדל״ן
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ───────────── master ───────────── */

export const LeadToDeal = () => {
  const frame = useCurrentFrame();
  const shake = useShake();
  // Music edit: tense intro cut dead on the snap, then the track's own build (22.5–24.0)
  // so its re-entry hit lands on the logo reveal at 13.18.
  const introVol = (fr) => interpolate(fr / FPS, [0, 0.3, 11.8, VO.snap], [0, 0.2, 0.2, 0], CL);
  const mainVol = (fr) => {
    const t = MUSIC_IN + fr / FPS;
    return interpolate(t, [MUSIC_IN, 12.6, 13.1, 13.3, 26.8, 27.3, 29.4, 30], [0.15, 0.45, 0.45, 0.28, 0.28, 0.5, 0.5, 0], CL);
  };
  return (
    <AbsoluteFill style={{background: C.deep, overflow: 'hidden'}}>
      <SvgDefs />
      <AbsoluteFill style={{transform: `translate(${shake.x}px, ${shake.y}px) rotate(${shake.r}deg) scale(1.03)`}}>
        <Scene from={0} to={CUTS[0]} whipOut={1}>
          <Hook />
        </Scene>
        <Scene from={CUTS[0]} to={CUTS[1]} whipIn={1}>
          <Question />
        </Scene>
        <Scene from={CUTS[1]} to={CUTS[2]}>
          <Silos />
        </Scene>
        <Scene from={CUTS[2]} to={CUTS[3]} whipOut={1}>
          <Connect />
        </Scene>
        <Scene from={CUTS[3]} to={CUTS[4]} whipIn={1} whipOut={1}>
          <Metrics />
        </Scene>
        <Scene from={CUTS[4]} to={30} whipIn={1}>
          <Cta />
        </Scene>
      </AbsoluteFill>
      <Vignette />
      <Grain />
      <Flash />
      <Audio src={staticFile('voiceover.mp3')} />
      <Audio src={staticFile('audio/music.mp3')} volume={introVol} endAt={f(VO.snap) + 1} />
      <Sequence from={f(MUSIC_IN)} layout="none">
        <Audio src={staticFile('audio/music.mp3')} startFrom={f(22.5)} volume={mainVol} />
      </Sequence>
      {SFX.map(([at, file, vol], i) => (
        <Sequence key={i} from={Math.max(0, f(at))} layout="none">
          <Audio src={staticFile(`audio/${file}.mp3`)} volume={vol} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
