package httpapi

import "net/http"

// corsMiddleware wraps a handler to add CORS headers required by the
// Firefox extension (moz-extension:// origin) when calling the API across
// origins. Without it the browser preflight OPTIONS request is rejected
// (405 / no CORS headers), the fetch throws before reaching the handler,
// and the client reports "Request failed." with nothing logged on the
// server.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Preflight: answer immediately so the browser permits the actual
		// request. Handle OPTIONS for any path, including unregistered ones.
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Max-Age", "86400")
			w.WriteHeader(http.StatusNoContent)
			return
		}

		wr := &corsResponseWriter{ResponseWriter: w}
		next.ServeHTTP(wr, r)
	})
}

// corsResponseWriter intercepts WriteHeader to inject CORS headers before
// the response is committed. The first call (explicit or implicit via Write)
// sets headers; subsequent calls are ignored.
type corsResponseWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (w *corsResponseWriter) WriteHeader(code int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.Header().Set("Access-Control-Allow-Origin", "*")
	// Retry-After is not a simple response header; expose it so the
	// extension client can read it cross-origin (rate-limit feedback).
	w.Header().Set("Access-Control-Expose-Headers", "Retry-After")
	w.ResponseWriter.WriteHeader(code)
}
