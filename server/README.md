# NoReplay Backend (server/)

Go HTTP service (`net/http`, SQLite via `modernc.org/sqlite` — CGO-free) that stores per-account watch catalogs and syncs them with the extension.

## Run locally

```sh
make run                   # Serve on :8080 (or go run ./cmd/server)
make check                 # Format check, go vet, and tests
make build                 # Build static binary to bin/noreplay
make help                  # Display all available targets
```

Environment variables: `ADDR` (default `:8080`), `DATABASE_PATH` (default `./data/noreplay.db`), `SIGNUP_EMAIL` (signup allowlist; empty/unset disables signup, fail-closed). Health endpoint: `GET /healthz`.

## Package & deploy

Dockerfile and Kubernetes manifests are in [`deploy/`](deploy/). See [`deploy/README.md`](deploy/README.md) for image build commands, manifest deployment, TLS requirements, and the single-replica rationale.
