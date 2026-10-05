const {Config} = require('@remotion/cli/config');
Config.setVideoImageFormat('jpeg');
Config.setChromiumOpenGlRenderer('swangle');
// Cloud sessions: point at Playwright's chrome-headless-shell; locally Remotion downloads its own.
if (process.env.REMOTION_CHROME) Config.setBrowserExecutable(process.env.REMOTION_CHROME);
