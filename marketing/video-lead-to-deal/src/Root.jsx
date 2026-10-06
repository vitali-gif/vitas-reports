import {Composition} from 'remotion';
import {LeadToDeal, FPS, DURATION} from './LeadToDeal';
import {Meeting, M_FPS, M_DURATION} from './Meeting';

export const Root = () => (
  <>
    <Composition id="LeadToDeal" component={LeadToDeal} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} />
    <Composition id="Meeting" component={Meeting} durationInFrames={M_DURATION} fps={M_FPS} width={1080} height={1920} />
  </>
);
