import "./hide-watched-core.js";

const core = globalThis.NoReplayHideWatched;

export const CONTAINER_SELECTORS = core.CONTAINER_SELECTORS;
export const SHELF_SELECTORS = core.SHELF_SELECTORS;
export const VIDEO_LINK_SELECTOR = core.VIDEO_LINK_SELECTOR;
export const extractVideoIdFromHref = core.extractVideoIdFromHref;
export const extractVideoIdFromElement = core.extractVideoIdFromElement;
export const shouldHideVideo = core.shouldHideVideo;
export const shouldHideShelf = core.shouldHideShelf;
