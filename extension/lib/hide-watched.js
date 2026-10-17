import "./hide-watched-core.js";

const core = globalThis.NoReplayHideWatched;

export const CONTAINER_SELECTORS = core.CONTAINER_SELECTORS;
export const extractVideoIdFromHref = core.extractVideoIdFromHref;
export const extractVideoIdFromElement = core.extractVideoIdFromElement;
export const shouldHideVideo = core.shouldHideVideo;
