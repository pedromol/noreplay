package store

import (
	"context"
	"time"
)

// SyncRecord is the client-facing shape of one catalog entry in a push batch.
// The merge is monotonic per KTD6: flags combine by OR and each timestamp
// keeps the largest value after future ones are clamped to the server clock,
// so pushes are commutative, associative and idempotent.
type SyncRecord struct {
	VideoID     string
	Watched     bool
	WatchedAt   int64
	NeverSkip   bool
	NeverSkipAt int64
}

// PushRecords merges each record into the user's catalog (never another
// account's) and returns the merged state of every touched record in push
// order. An empty batch is a no-op.
func (s *Store) PushRecords(ctx context.Context, userID string, records []SyncRecord, now time.Time) ([]CatalogRecord, error) {
	merged := make([]CatalogRecord, 0, len(records))
	for _, rec := range records {
		m, err := s.UpsertCatalogRecord(ctx, CatalogRecord{
			UserID:      userID,
			VideoID:     rec.VideoID,
			Watched:     rec.Watched,
			WatchedAt:   rec.WatchedAt,
			NeverSkip:   rec.NeverSkip,
			NeverSkipAt: rec.NeverSkipAt,
		}, now)
		if err != nil {
			return nil, err
		}
		merged = append(merged, m)
	}
	return merged, nil
}
