package httpapi

import (
	"net/http"

	"noreplay/server/internal/store"
)

type Options struct{}

func NewRouter(s *store.Store, opts Options) *http.ServeMux {
	_ = s
	_ = opts
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	return mux
}
