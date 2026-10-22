# noreplay backend (server/)

Go HTTP service (`net/http`, SQLite via `modernc.org/sqlite` — no CGO) that
stores the per-account watch catalog and syncs it with the extension.

## Run locally

```sh
make run                   # serves on :8080 (or go run ./cmd/server)
make check                 # format check, go vet, and tests
make build                 # builds static binary to bin/noreplay
make help                  # displays all available targets
```

Environment: `ADDR` (default `:8080`), `DATABASE_PATH` (default
`./data/noreplay.db`), `SIGNUP_EMAIL` (signup allowlist; empty/unset disables
signup, fail-closed). Endpoint: `GET /healthz`.

## Package & deploy

Dockerfile and Kubernetes manifests live under [`deploy/`](deploy/) — see
[`deploy/README.md`](deploy/README.md) for the image build command, manifest
application, the TLS requirement, and the single-replica rationale.
