(function (root) {
  function isHistoryPath(pathname) {
    if (typeof pathname !== "string") return false;
    return pathname === "/feed/history" || pathname.startsWith("/feed/history/");
  }

  root.NoReplayHistoryPath = {
    isHistoryPath,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
