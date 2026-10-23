import test from "node:test";
import assert from "node:assert/strict";

import {
  isHistoryPath,
  createHideWatchedController,
} from "../lib/hide-watched.js";

const core = globalThis.NoReplayHideWatched;

class FakeClassList {
  constructor(values = []) {
    this.values = new Set(values);
  }

  add(...names) {
    for (const name of names) this.values.add(name);
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.contains(name) : Boolean(force);
    if (shouldAdd) {
      this.add(name);
    } else {
      this.remove(name);
    }
    return shouldAdd;
  }
}

function makeCard({ videoId = "aaa111bbb22", progressPercent = null, classes = [] } = {}) {
  const stats = { progressQueries: 0 };
  const element = {
    classList: new FakeClassList(classes),
    querySelector(selector) {
      if (selector === core.PROGRESS_SELECTOR) {
        stats.progressQueries += 1;
        return progressPercent === null
          ? null
          : { style: { width: `${progressPercent}%` } };
      }
      if (selector === core.VIDEO_LINK_SELECTOR) {
        if (!videoId) return null;
        const href = `/watch?v=${videoId}`;
        return {
          getAttribute(attr) {
            return attr === "href" ? href : null;
          },
          href: `https://www.youtube.com${href}`,
        };
      }
      return null;
    },
  };
  return { element, stats };
}

function makeShelf(items) {
  return {
    classList: new FakeClassList(),
    querySelectorAll(selector) {
      return selector === core.CONTAINER_SELECTORS.join(", ") ? items : [];
    },
  };
}

function makeDocument(containers = [], shelves = []) {
  const body = { classList: new FakeClassList() };
  return {
    body,
    documentElement: body,
    querySelectorAll(selector) {
      if (selector === core.CONTAINER_SELECTORS.join(", ")) return containers;
      if (selector === core.SHELF_SELECTORS.join(", ")) return shelves;
      return [];
    },
  };
}

function makeController({
  document,
  window,
  isEnabled = () => true,
  catalog = () => ({}),
  pathname = () => "/",
} = {}) {
  return createHideWatchedController({
    core,
    document,
    window,
    isEnabled,
    catalog,
    pathname,
  });
}

function makeSchedulerWindow({ withAnimationFrame = true } = {}) {
  const stats = { scheduled: 0, delays: [], callbacks: [] };

  const window = {
    stats,
    setTimeout(callback, delay) {
      stats.scheduled += 1;
      stats.delays.push(delay);
      stats.callbacks.push(callback);
      return stats.scheduled;
    },
    flush() {
      const callbacks = stats.callbacks.splice(0);
      for (const callback of callbacks) callback(0);
    },
  };

  if (withAnimationFrame) {
    window.requestAnimationFrame = (callback) => {
      stats.scheduled += 1;
      stats.callbacks.push(callback);
      return stats.scheduled;
    };
  }

  return window;
}

test("isHistoryPath matches the history page and its subpaths", () => {
  assert.equal(isHistoryPath("/feed/history"), true);
  assert.equal(isHistoryPath("/feed/history/"), true);
  assert.equal(isHistoryPath("/feed/history/videos"), true);
  assert.equal(isHistoryPath("/feed/subscriptions"), false);
  assert.equal(isHistoryPath("/watch"), false);
  assert.equal(isHistoryPath(""), false);
  assert.equal(isHistoryPath(null), false);
});

test("controller clears the hidden class and skips progress reads when disabled", () => {
  const card = makeCard({
    progressPercent: 90,
    classes: ["noreplay-watched-hidden"],
  });
  const doc = makeDocument([card.element]);
  const controller = makeController({ document: doc, isEnabled: () => false });

  controller.scanAllContainers();

  assert.equal(card.element.classList.contains("noreplay-watched-hidden"), false);
  assert.equal(card.stats.progressQueries, 0);
  assert.equal(doc.body.classList.contains("noreplay-hide-watched-enabled"), false);
});

test("controller hides cards by catalog state and progress while honoring neverSkip", () => {
  const watched = makeCard({ videoId: "watched1234", progressPercent: 0 });
  const partial = makeCard({ videoId: "partial1234", progressPercent: 30 });
  const below = makeCard({ videoId: "below12345", progressPercent: 10 });
  const neverSkip = makeCard({ videoId: "neverSkip12", progressPercent: 90 });
  const doc = makeDocument([watched.element, partial.element, below.element, neverSkip.element]);
  const controller = makeController({
    document: doc,
    catalog: () => ({
      watched1234: { watched: true, neverSkip: false },
      neverSkip12: { watched: false, neverSkip: true },
    }),
  });

  controller.scanAllContainers();

  assert.equal(watched.element.classList.contains("noreplay-watched-hidden"), true);
  assert.equal(partial.element.classList.contains("noreplay-watched-hidden"), true);
  assert.equal(below.element.classList.contains("noreplay-watched-hidden"), false);
  assert.equal(neverSkip.element.classList.contains("noreplay-watched-hidden"), false);
  assert.equal(doc.body.classList.contains("noreplay-hide-watched-enabled"), true);
});

test("controller leaves the history page visible and removes the body class", () => {
  const card = makeCard({ progressPercent: 100 });
  const doc = makeDocument([card.element]);
  doc.body.classList.add("noreplay-hide-watched-enabled");
  const controller = makeController({
    document: doc,
    pathname: () => "/feed/history",
  });

  controller.scanAllContainers();

  assert.equal(card.element.classList.contains("noreplay-watched-hidden"), false);
  assert.equal(card.stats.progressQueries, 0);
  assert.equal(doc.body.classList.contains("noreplay-hide-watched-enabled"), false);
});

test("requestScan coalesces scans and resets the latch after a flush", () => {
  const card = makeCard({ progressPercent: 30 });
  const doc = makeDocument([card.element]);
  const win = makeSchedulerWindow();
  const controller = makeController({ document: doc, window: win });

  controller.requestScan();
  controller.requestScan();

  assert.equal(win.stats.scheduled, 1);
  assert.equal(card.stats.progressQueries, 0);

  win.flush();

  assert.equal(card.stats.progressQueries, 1);

  controller.requestScan();

  assert.equal(win.stats.scheduled, 2);
});

test("requestScan schedules nothing on the history page", () => {
  const card = makeCard({ progressPercent: 90 });
  const doc = makeDocument([card.element]);
  doc.body.classList.add("noreplay-hide-watched-enabled");
  const win = makeSchedulerWindow();
  const controller = makeController({
    document: doc,
    window: win,
    pathname: () => "/feed/history",
  });

  controller.requestScan();

  assert.equal(win.stats.scheduled, 0);
  assert.equal(card.stats.progressQueries, 0);
  assert.equal(doc.body.classList.contains("noreplay-hide-watched-enabled"), false);
});

test("requestScan falls back to setTimeout without requestAnimationFrame", () => {
  const card = makeCard({ progressPercent: 40 });
  const doc = makeDocument([card.element]);
  const win = makeSchedulerWindow({ withAnimationFrame: false });
  const controller = makeController({ document: doc, window: win });

  controller.requestScan();

  assert.equal(win.stats.scheduled, 1);
  assert.deepEqual(win.stats.delays, [16]);
  assert.equal(card.stats.progressQueries, 0);

  win.flush();

  assert.equal(card.stats.progressQueries, 1);
});

test("controller hides a shelf only when every item qualifies", () => {
  const first = makeCard({ videoId: "shelf111111", progressPercent: 40 });
  const second = makeCard({ videoId: "shelf222222", progressPercent: 80 });
  const shelf = makeShelf([first.element, second.element]);
  const doc = makeDocument([], [shelf]);
  const controller = makeController({ document: doc });

  controller.scanAllContainers();

  assert.equal(shelf.classList.contains("noreplay-watched-hidden"), true);
});
