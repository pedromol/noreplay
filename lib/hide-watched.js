import "./history-path-core.js";
import "./hide-watched-core.js";
import "./hide-watched-controller.js";

const core = globalThis.NoReplayHideWatched;
const controller = globalThis.NoReplayHideWatchedController;

export const CONTAINER_SELECTORS = core.CONTAINER_SELECTORS;
export const SHELF_SELECTORS = core.SHELF_SELECTORS;
export const VIDEO_LINK_SELECTOR = core.VIDEO_LINK_SELECTOR;
export const PROGRESS_SELECTORS = core.PROGRESS_SELECTORS;
export const PROGRESS_SELECTOR = core.PROGRESS_SELECTOR;
export const RESUME_PROGRESS_HIDE_PERCENT = core.RESUME_PROGRESS_HIDE_PERCENT;
export const extractVideoIdFromHref = core.extractVideoIdFromHref;
export const extractVideoIdFromElement = core.extractVideoIdFromElement;
export const extractProgressPercentFromElement = core.extractProgressPercentFromElement;
export const shouldHideByProgress = core.shouldHideByProgress;
export const shouldHideVideo = core.shouldHideVideo;
export const shouldHideItem = core.shouldHideItem;
export const shouldHideShelf = core.shouldHideShelf;
export const isHistoryPath = controller.isHistoryPath;
export const createHideWatchedController = controller.createHideWatchedController;
