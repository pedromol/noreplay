# Deploy — noreplay backend

Kubernetes manifests for the Go backend (`server/`). Requirements: R12.

## 1. Build the image

Build context is the `server/` directory; the Dockerfile sits at its root, so no
`-f` flag is needed. From the **repository root**:

```sh
docker build -t noreplay:latest server
```

(Equivalent: `cd server && docker build -t noreplay:latest .`)

The build is multi-stage and CGO-free (`CGO_ENABLED=0`, pure-Go SQLite driver),
so the binary runs on the distroless `static` base without libc. The final image
runs as uid/gid `65532` (`USER 65532:65532`, `:nonroot` tag).

**No `HEALTHCHECK` in the Dockerfile:** distroless images have no shell and no
`wget`/`curl`, so a shell-based healthcheck cannot run. Health is instead
guaranteed by the Kubernetes HTTP probes on `/healthz` in `deployment.yaml`
(readiness + liveness).

Docker is only needed on the machine that builds/pushes the image; the cluster
pulls it from your registry (adjust `image:` in `deployment.yaml` accordingly).

## 2. Environment variables

All read from the container environment, provided by the ConfigMap
(`envFrom` in `deployment.yaml`):

| Key              | Default             | Meaning                                                                 |
| ---------------- | ------------------- | ----------------------------------------------------------------------- |
| `ADDR`           | `:8080`             | Listen address. Keep `:8080`; it must match the container port/probes.  |
| `DATABASE_PATH`  | `./data/noreplay.db`| Use `/data/noreplay.db` in Kubernetes — that is where the PVC is mounted. |
| `SIGNUP_EMAIL`   | *(unset = disabled)* | Signup allowlist (single e-mail, case/space-insensitive). Empty/missing disables signup (fail-closed, KTD8). Not a secret. |

Secrets (TLS certificate today; anything sensitive tomorrow) come only from
mounted/ referenced Secrets — never literal values in versioned manifests (KTD8).

## 3. Apply the manifests

```sh
# 1. Edit the ConfigMap section of the single manifest (allowlist e-mail first)
$EDITOR server/deploy/k8s/deployment.yaml

# 2. Create the TLS Secret for the Ingress host (example with cert-manager,
#    or any other way of producing a kubernetes.io/tls Secret)
#    The Secret NAME must match spec.tls[].secretName in deployment.yaml.

# 3. Apply everything
kubectl apply -f server/deploy/k8s/deployment.yaml

# Validate without touching the cluster
kubectl apply --dry-run=client -f server/deploy/k8s/deployment.yaml
```

Manifests are namespace-agnostic (no `namespace:` field): they apply to the
current namespace of the kubeconfig/context.

Every resource lives in the single file `deploy/k8s/deployment.yaml`:

| Resource          | Kind                   | Notes                                             |
| ----------------- | ---------------------- | ------------------------------------------------- |
| `noreplay`        | Deployment             | `replicas: 1`, `strategy: Recreate`, probes        |
| `noreplay`        | Service (ClusterIP)    | 8080 → pod 8080                                   |
| `noreplay`        | Ingress                | TLS termination + HTTPS redirect                  |
| `noreplay-config` | ConfigMap              | Env vars — edit `SIGNUP_EMAIL` before applying     |
| `noreplay-data`   | PersistentVolumeClaim  | RWO, holds `/data/noreplay.db`                    |

## 4. TLS is mandatory

The extension authenticates with a bearer token in the `Authorization` header
(KTD4). The token must never travel in clear, so:

- The extension only sends the token to `https` origins (loopback is allowed in
  development only, KTD4).
- The Ingress therefore terminates TLS (`spec.tls` referencing the
  `noreplay-tls` Secret) and force-redirects HTTP to HTTPS. Deploying on plain
  HTTP outside loopback is invalid.

Replace `noreplay.example.com` in `deployment.yaml` with your host and point DNS
accordingly. `ingressClassName: nginx` is an example — match your cluster's
ingress controller.

## 5. Exactly one replica, `Recreate` strategy

The backend stores state in a single SQLite file on a `ReadWriteOnce` volume.
Two pods would mount the same file concurrently and corrupt it, and RWO only
allows attachment to one node anyway. Therefore:

- `replicas: 1` (hard-coded; horizontal scaling is out of MVP scope).
- `strategy: type: Recreate` so the old pod is fully stopped before the new one
  starts — a `RollingUpdate` would briefly run two writers.

## 6. Persistent state
The PersistentVolumeClaim in `deployment.yaml` creates a `ReadWriteOnce` claim
mounted at `/data`; the app writes the database to
`DATABASE_PATH=/data/noreplay.db`. The pod also uses a `readOnlyRootFilesystem`
with an `emptyDir` at `/tmp`, so nothing is written inside the container layer.
Deleting/recreating the Pod keeps the data; deleting the PVC (or the namespace)
does not.

The `storageClassName` is omitted to use the cluster default — it is
cluster-specific; set it explicitly if needed (see comments in
`deployment.yaml`).
The container runs as non-root (`65532`), and the pod sets `fsGroup: 65532` so
the mounted volume is writable by that user.

## 7. Smoke check

```sh
kubectl rollout status deployment/noreplay
kubectl port-forward svc/noreplay 8080:8080
curl -fsS http://localhost:8080/healthz
```

(Loopback plain HTTP is fine for a local health check; real traffic with tokens
must go through the TLS Ingress.)
