package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"noreplay/server/internal/store"
)

// maxSyncBatchRecords bounds one push batch so a single authenticated body
// cannot force unbounded merge work.
const maxSyncBatchRecords = 500

// syncPushRecord mirrors one catalog entry in a push body. Unknown JSON
// fields are accepted and ignored (additive contract); timestamps decode as
// integers, so a non-integer timestamp is a decode error.
type syncPushRecord struct {
	VideoID     string `json:"videoId"`
	Watched     bool   `json:"watched"`
	WatchedAt   int64  `json:"watchedAt"`
	NeverSkip   bool   `json:"neverSkip"`
	NeverSkipAt int64  `json:"neverSkipAt"`
}

type syncPushRequest struct {
	Records []syncPushRecord `json:"records"`
}

type syncCatalogItem struct {
	VideoID     string `json:"videoId"`
	Watched     bool   `json:"watched"`
	WatchedAt   int64  `json:"watchedAt"`
	NeverSkip   bool   `json:"neverSkip"`
	NeverSkipAt int64  `json:"neverSkipAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

type syncPullResponse struct {
	Records []syncCatalogItem `json:"records"`
}

type syncPushResponse struct {
	Merged int `json:"merged"`
}

// handleSyncPush merges an authenticated batch into the caller's catalog
// handleSyncPush merges an authenticated batch into the caller's catalog
// (KTD6 monotonic merge) and reports how many records were applied.
func (s *server) handleSyncPush(w http.ResponseWriter, r *http.Request) {
	user, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	slog.Info("sync push attempt", "user_id", user.ID)
	var req syncPushRequest
	if err := ReadJSONBody(w, r, &req, s.maxBody); err != nil {
		if errors.Is(err, ErrBodyTooLarge) {
			slog.Warn("sync push rejected: body too large", "user_id", user.ID)
			writeError(w, http.StatusRequestEntityTooLarge, "body_too_large")
			return
		}
		slog.Warn("sync push rejected: invalid request", "user_id", user.ID, "error", err)
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if len(req.Records) > maxSyncBatchRecords {
		slog.Warn("sync push rejected: batch too large", "user_id", user.ID, "count", len(req.Records))
		writeError(w, http.StatusBadRequest, "batch_too_large")
		return
	}

	records := make([]store.SyncRecord, 0, len(req.Records))
	for _, rec := range req.Records {
		if rec.VideoID == "" {
			slog.Warn("sync push rejected: empty videoId", "user_id", user.ID)
			writeError(w, http.StatusBadRequest, "invalid_request")
			return
		}
		records = append(records, store.SyncRecord{
			VideoID:     rec.VideoID,
			Watched:     rec.Watched,
			WatchedAt:   rec.WatchedAt,
			NeverSkip:   rec.NeverSkip,
			NeverSkipAt: rec.NeverSkipAt,
		})
	}

	if _, err := s.store.PushRecords(r.Context(), user.ID, records, s.now()); err != nil {
		slog.Error("sync push failed: store error", "user_id", user.ID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	slog.Info("sync push successful", "user_id", user.ID, "merged", len(records))
	writeJSON(w, http.StatusOK, syncPushResponse{Merged: len(records)})
}

// handleSyncPull returns the account's full consolidated catalog (KTD9).
// An empty account answers with an empty records array; the response is
// idempotent.
func (s *server) handleSyncPull(w http.ResponseWriter, r *http.Request) {
	user, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	slog.Info("sync pull attempt", "user_id", user.ID)
	records, err := s.store.ListCatalog(r.Context(), user.ID)
	if err != nil {
		slog.Error("sync pull failed: store error", "user_id", user.ID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	slog.Info("sync pull successful", "user_id", user.ID, "records", len(records))
	items := make([]syncCatalogItem, 0, len(records))
	for _, rec := range records {
		items = append(items, syncCatalogItem{
			VideoID:     rec.VideoID,
			Watched:     rec.Watched,
			WatchedAt:   rec.WatchedAt,
			NeverSkip:   rec.NeverSkip,
			NeverSkipAt: rec.NeverSkipAt,
			UpdatedAt:   rec.UpdatedAt,
		})
	}
	writeJSON(w, http.StatusOK, syncPullResponse{Records: items})
}
