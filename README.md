# NoReplay

Extensão Firefox MV3 + serviço Go que pula vídeos já assistidos no YouTube,
com catálogo local, sincronização monotônica (KTD6) e suporte a Shorts.

## Estrutura

```
.
├── AGENTS.md          # diretrizes de desenvolvimento e invariantes
├── extension/         # Firefox extension (MV3, ES modules, background scripts)
│   ├── content/       # content scripts (skip, progress, history, hide-watched, navigator)
│   ├── lib/           # módulos compartilhados (video.js, background.js, navigation.js, hide-watched-core.js, ...)
│   ├── sync/          # cliente/engine de sincronização com o servidor
│   ├── storage/       # catálogo local (browser.storage.local)
│   ├── options/       # página de opções
│   ├── tests/         # node:test (lint + lint:manifest + build via web-ext)
│   └── manifest.json  # MV3, permisos de tabs/storage; não service worker
├── server/            # Go HTTP (net/http, modernc.org/sqlite, sem CGO, WAL)
│   ├── cmd/server/    # ponto de entrada
│   ├── internal/      # httpapi, store, auth (argon2id, SHA-256 tokens 30d)
│   ├── deploy/        # Dockerfile + Kubernetes (deployment.yaml, k8s/)
│   └── README.md      # execução local (make run / check / build)
└── docs/
    └── plans/         # documentos de planejamento preservados
```

## Objetivo

- **Offline-first**: extensão opera sem conta via `browser.storage.local`; detecção,
  countdown de 5s, acumulação de playtime e exceções "nunca pular" funcionam sem rede.
- **Threshold de watch**: marcado assistido quando playtime ativo atinge o menor de
  30s ou 25% da duração; busca não conta; playtime acumula entre sessões.
- **Contagem graciosa**: overlay aparece em vídeos assistidos sem exceção; clique
  cancela; checkbox "nunca pular" marca exceção e permite reprodução.
- **Sincronização monotônica (KTD6)**: merge por OR em `watched`/`neverSkip`,
  `max(stored, incoming)` em timestamps, clamped ao relógio do servidor; coalescência
  dentro de ciclo ativo; logout isola (não apaga catálogo local).
- **Shorthand** (Shorts): `extractVideoId` resolve `/shorts/<id>`; containers
  `ytd-shorts-lockup-viewer`/`ytd-reel-item-renderer` ocultados; histórico e progresso
  tratam dedup entre `/watch?v=` e `/shorts/`.
- **Segurança**: tokens apenas em `Authorization: Bearer` via TLS; signup restrito a
  `SIGNUP_EMAIL` (fail-closed); rate-limit 5/min em `/v1/signup` e `/v1/login`.

## Afinidades e referências

- `AGENTS.md`: invariantes arquiteturais (trust boundary, monotonic merge, passkeys,
  rate limit, SQLite WAL/foreign_keys, falha-fechada). Não editar sem relê-lo.
- `extension/README.md`: build (`npm test`, `npm run lint`, `npm run lint:manifest`,
  `npm run build` via web-ext) e manifest.
- `server/README.md` / `Makefile`: execução local (`make run`/`check`/`build`; binário
  estático `bin/noreplay`); ambiente `ADDR`, `DATABASE_PATH`, `SIGNUP_EMAIL`.
- `docs/plans/`: planos de projeto preservados conforme regra de documentação.
- `extension/manifest.json`: MV3 (`background.scripts`, não service workers); permissões
  de tab/URL necessárias para `browser.tabs.get` (resolução canônica do videoId).

## Verificação rápida

```sh
# extensao
cd extension && npm test && npm run lint && npm run lint:manifest

# servidor
cd server && go test ./... && go vet ./... && make check
```

---
*Criado em 2026-10-22. Baseado em AGENTS.md e código existente; não substitui planos
em `docs/plans/` nem testes existentes.*
