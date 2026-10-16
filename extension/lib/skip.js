import "./skip-core.js";

const core = globalThis.NoReplaySkip;

export const SKIP_GRACE_MS = core.SKIP_GRACE_MS;
export const createSkipCountdown = core.createSkipCountdown;
export const createSkipSession = core.createSkipSession;
