---
title: "Suporte Completo a Shorts no NoReplay"
date: 2026-10-17
type: feat
status: done
artifact_contract: ce-unified-plan/v1
product_contract_source: session-decisions
execution: code
---

# Suporte Completo a Shorts no NoReplay

## Goal Capsule

- **Objective:** Fazer o NoReplay tratar vídeos do YouTube Shorts de ponta a ponta: importar Shorts do histórico, ocultar cards de Shorts assistidos nas linhas/prateleiras (incluindo ocultar a linha inteira quando todos estiverem assistidos) e habilitar skip/progresso no player de `/shorts/<id>`.
- **Means:** Estender `extractVideoId` para `/shorts/<id>`, reconhecer âncoras `/shorts/` na importação de histórico e na ocultação, e adicionar avaliação de prateleiras (`shouldHideShelf`) no content script de ocultação.
- **Product Authority:** Decisões registradas em sessão (usuário escolheu escopo completo: importar + ocultar + skip; e ocultar a linha inteira quando vazia de não-assistidos).
- **Open Blockers:** Nenhum.

## Product Contract

### Summary

Ao importar o histórico do YouTube, Shorts também entram no catálogo. Ao navegar, cards de Shorts já assistidos são ocultados das prateleiras (ex.: linha "Shorts" da home) e, quando todos os Shorts visíveis de uma linha estão assistidos (sem exceção "nunca pular"), a linha inteira — título incluído — é ocultada. No player de Shorts, o progresso acumula e o overlay de skip de 5s aparece como nos vídeos normais.

### Key Decisions

- **KD1: Suporte completo a `/shorts/` (importar + ocultar + skip/progresso).** *(session-settled: user-directed — chosen over restringir a importação+ocultação: manter uma única fonte canônica de ID de vídeo para todas as features.)* Governs R1, R4.
- **KD2: Ocultar a linha inteira da prateleira quando todos os Shorts visíveis estiverem assistidos.** *(session-settled: user-directed — chosen over manter linha vazia com título: evita prateleira "Shorts" fantasma na home.)* Governs R3.
- **KD3: Prateleira nunca é ocultada se estiver vazia, sem IDs identificáveis ou com qualquer vídeo não-assistido/com exceção.** Governs R3.

### Requirements

- R1. `extractVideoId` aceita URLs `https://www.youtube.com/shorts/<id>` (segmento único, id no padrão canônico), mantendo rejeição de hosts não-YouTube e caminhos malformados. Governed by KD1.
- R2. A importação de histórico coleta links `a[href*="/watch"]` e `a[href*="/shorts/"]`, com deduplicação por ID. Governed by KD1.
- R3. A ocultação reconhece cards de Shorts (âncoras `/shorts/`, seletores `ytd-reel-item-renderer` e `ytd-shorts-lockup-view-model`) e oculta a linha da prateleira (`ytd-rich-shelf-renderer`, `ytd-reel-shelf-renderer`) apenas quando todos os Shorts identificáveis estão ocultos. Governed by KD2, KD3.
- R4. O player de Shorts (`/shorts/<id>`) acumula progresso e exibe o overlay de skip respeitando `neverSkip`. Governed by KD1.

### Scope Boundaries

- **In Scope:** `extension/lib/video.js`, `extension/lib/hide-watched-core.js`, `extension/lib/hide-watched.js`, `extension/content/hide-watched.js`, `extension/content/history.js`, testes associados, AGENTS.md.
- **Outside this Product's Identity (Non-goals):** Alterações no backend Go, novas preferências de UI, Google Takeout.

## Planning Contract

### Key Technical Decisions

- **KTD1: Uma única fonte canônica de extração de ID.** `extractVideoId` (lib/video.js) ganha ramificação `/shorts/<id>`; `navigation.js`, `background.js` (playback, mark-never-skip, video-state) e `history-core.js` herdam o comportamento sem alteração de código — preservando a invariante de que o background resolve o ID da URL real da aba (`browser.tabs.get`).
- **KTD2: Core UMD puro para prateleiras.** `shouldHideShelf(shelf, isFeatureEnabled, catalog)` vive em `hide-watched-core.js` (sem DOM real, testável com objetos fake): percorre containers filhos, e só oculta se ≥1 ID foi extraível e todos satisfazem `shouldHideVideo`.
- **KTD3: Reuso da classe existente.** A linha oculta usa a mesma classe `.noreplay-watched-hidden` e o mesmo toggle `noreplay-hide-watched-enabled` — zero mudanças de CSS.
- **KTD4: Selector unificado de âncoras.** `VIDEO_LINK_SELECTOR = 'a[href*="/watch"], a[href*="/shorts/"]'` usado em cards e na importação; deduplicação por `Set`/catálogo cobre o mesmo vídeo nos dois formatos.

### Implementation Units

- **U1 — `lib/video.js` + `tests/navigation.test.js`:** `extractVideoId` aceita `/shorts/<id>`; testes de URL shorts válidas, com query e malformadas.
- **U2 — `lib/hide-watched-core.js`, `lib/hide-watched.js`, `content/hide-watched.js` + `tests/hide-watched-core.test.js`:** shorts em `extractVideoIdFromHref`/`FromElement`, novos `CONTAINER_SELECTORS`, `SHELF_SELECTORS`, `VIDEO_LINK_SELECTOR` e `shouldHideShelf`; content script avalia prateleiras após os cards.
- **U3 — `content/history.js` + `tests/history-core.test.js`:** extractor local aceita `/shorts/`, query inclui ambos os formatos; teste de deduplicação watch↔shorts.
- **U4 — Player de Shorts:** sem código novo; coberto por U1 (progresso, skip, navegação).
- **U5 — Documentação e verificação:** AGENTS.md ("watch e shorts pages"), este plano em `docs/plans/`.

## Verification Contract

```bash
cd extension
npm test             # 112 testes (novos: shorts hrefs, shouldHideShelf, history shorts)
npm run lint
npm run lint:manifest

cd server
go test ./...
go vet ./...
```

### Quality Gates

1. Todos os testes passam sem regressão nos suites existentes (skip, catalog, sync, history-import).
2. ESLint e `web-ext lint` sem erros/avisos.
3. Servidor Go inalterado e verde.

## Definition of Done

- [x] `extractVideoId` aceita `/shorts/<id>` com testes.
- [x] Importação de histórico coleta Shorts com deduplicação, com testes.
- [x] Cards de Shorts ocultados e `shouldHideShelf` coberto por testes.
- [x] `AGENTS.md` atualizado; plano arquivado em `docs/plans/`.
- [x] `npm test`, `npm run lint`, `npm run lint:manifest`, `go test ./...`, `go vet ./...` verdes.
