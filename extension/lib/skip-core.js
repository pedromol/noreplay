(function (root) {
  var SKIP_GRACE_MS = 5000;
  var TICK_MS = 1000;

  function createSkipCountdown(options) {
    var opts = options || {};
    var durationMs = opts.durationMs === undefined ? SKIP_GRACE_MS : opts.durationMs;
    var now = typeof opts.now === "function" ? opts.now : function () { return Date.now(); };
    var timer = opts.timer;
    var isVisible = typeof opts.isVisible === "function" ? opts.isVisible : function () { return true; };
    var onTick = typeof opts.onTick === "function" ? opts.onTick : null;
    var onExpire = typeof opts.onExpire === "function" ? opts.onExpire : null;

    var total = typeof durationMs === "number" && durationMs > 0 ? durationMs : 0;

    var remaining = total;
    var deadline = 0;
    var started = false;
    var running = false;
    var expired = false;
    var timerId = null;

    function emitTick() {
      if (onTick) onTick(remaining);
    }

    function clearTimer() {
      if (timerId !== null) {
        timer.cancel(timerId);
        timerId = null;
      }
    }

    function expire() {
      if (expired) return;
      expired = true;
      running = false;
      clearTimer();
      if (onExpire) onExpire();
    }

    function schedule() {
      if (!running || remaining <= 0) return;
      timerId = timer.schedule(onTimer, Math.min(TICK_MS, remaining));
    }

    function onTimer() {
      timerId = null;
      if (!running || expired) return;
      if (!isVisible()) {
        running = false;
        return;
      }
      remaining = Math.max(0, deadline - now());
      emitTick();
      if (remaining <= 0) {
        expire();
        return;
      }
      schedule();
    }

    function start() {
      clearTimer();
      started = true;
      expired = false;
      remaining = total;
      if (remaining <= 0) {
        running = true;
        emitTick();
        expire();
        return;
      }
      deadline = now() + remaining;
      running = true;
      emitTick();
      schedule();
    }

    function pause() {
      if (!running) return;
      remaining = Math.max(0, deadline - now());
      clearTimer();
      running = false;
    }

    function resume() {
      if (!started || running || expired) return;
      if (remaining <= 0) {
        running = true;
        emitTick();
        expire();
        return;
      }
      deadline = now() + remaining;
      running = true;
      schedule();
    }

    function cancel() {
      clearTimer();
      started = false;
      running = false;
    }

    function remainingMs() {
      if (running) return Math.max(0, deadline - now());
      return Math.max(0, remaining);
    }

    function isRunning() {
      return running;
    }

    return {
      start: start,
      pause: pause,
      resume: resume,
      cancel: cancel,
      remainingMs: remainingMs,
      isRunning: isRunning,
    };
  }

  function createSkipSession(options) {
    var opts = options || {};
    var durationMs = opts.durationMs === undefined ? SKIP_GRACE_MS : opts.durationMs;
    var now = typeof opts.now === "function" ? opts.now : function () { return Date.now(); };
    var timer = opts.timer;
    var isVisible = typeof opts.isVisible === "function" ? opts.isVisible : function () { return true; };
    var onTick = typeof opts.onTick === "function" ? opts.onTick : null;
    var onSkip = typeof opts.onSkip === "function" ? opts.onSkip : null;

    var boundVideoId = null;
    var countdown = null;

    function open(videoId) {
      if (typeof videoId !== "string" || videoId.length === 0) return false;
      close();
      boundVideoId = videoId;
      countdown = createSkipCountdown({
        durationMs: durationMs,
        now: now,
        timer: timer,
        isVisible: isVisible,
        onTick: onTick,
        onExpire: function () {
          var expiredFor = boundVideoId;
          countdown = null;
          boundVideoId = null;
          if (onSkip) onSkip(expiredFor);
        },
      });
      countdown.start();
      return true;
    }

    function close() {
      if (countdown) {
        countdown.cancel();
        countdown = null;
      }
      boundVideoId = null;
    }

    function current() {
      return boundVideoId;
    }

    function isActive() {
      return countdown !== null;
    }

    function remainingMs() {
      return countdown ? countdown.remainingMs() : 0;
    }

    function pause() {
      if (countdown) countdown.pause();
    }

    function resume() {
      if (countdown) countdown.resume();
    }

    return {
      open: open,
      close: close,
      current: current,
      isActive: isActive,
      remainingMs: remainingMs,
      pause: pause,
      resume: resume,
    };
  }

  var api = {
    SKIP_GRACE_MS: SKIP_GRACE_MS,
    createSkipCountdown: createSkipCountdown,
    createSkipSession: createSkipSession,
  };

  root.NoReplaySkip = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
