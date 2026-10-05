import {Composition} from 'remotion';
import {LeadToDeal, FPS, DURATION} from './LeadToDeal';

export const Root = () => (
  <Composition id="LeadToDeal" component={LeadToDeal} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} />
);
