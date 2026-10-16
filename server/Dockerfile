# syntax=docker/dockerfile:1

### Build stage
# Builder image tracks go.mod (`go 1.27`). Build is CGO-free (KTD5:
# modernc.org/sqlite is a pure-Go driver), so CGO_ENABLED=0 yields a static binary.
FROM golang:1.27 AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/noreplay ./cmd/server

### Final stage
# Distroless static: no shell, no package manager, nothing to CVE-scan.
# :nonroot ships USER 65532; set explicitly below so the non-root guarantee is
# visible in this file.
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app

COPY --from=builder /out/noreplay /app/noreplay

# Explicit non-root user (uid/gid 65532, same as the :nonroot tag default).
USER 65532:65532

# App defaults; DATABASE_PATH points at the mounted PVC (state outside the container).
ENV ADDR=":8080" \
    DATABASE_PATH="/data/noreplay.db"

EXPOSE 8080

# NOTE: no HEALTHCHECK directive. Distroless images contain no shell and no
# wget/curl, so a shell-based HEALTHCHECK cannot run. Liveness/readiness are
# provided by the Kubernetes HTTP probes on /healthz (deploy/k8s/deployment.yaml).

ENTRYPOINT ["/app/noreplay"]
