# NoReplay — extensão Firefox

Pula automaticamente vídeos do YouTube que já foram assistidos, dando 5 segundos
para assistir de novo antes de seguir para o próximo vídeo sugerido.

## Arquitetura

- O **background** (event page MV3, `background.scripts` com `type: "module"`) é o
  dono único de `storage.local`: catálogo e token de sessão. Content scripts e a
  página de opções só alcançam esse estado por mensagens.
- Os **content scripts** são scripts clássicos (Firefox não suporta content scripts
  como módulos ES) e cuidam apenas do DOM e dos sinais da página.
- A lógica pura e testável vive em `lib/` e `storage/`, importada pelo background e
  pelos testes (`node --test`).

## Desenvolvimento

```bash
npm install          # eslint + web-ext (devDependencies)
npm test             # testes unitários (node --test)
npm run lint         # eslint
npm run lint:manifest  # web-ext lint (valida o manifest MV3)
```

Smoke manual em Firefox real:

```bash
npx web-ext run --source-dir .
```

Carregue o YouTube, navegue para um vídeo, assista além do limiar, reabra o vídeo e
verifique o popup. O checklist completo do smoke (AE1–AE8) está na seção
"Smoke manual" abaixo.

## Instalação permanente

A instalação permanente exige assinatura na AMO ou o modo de desenvolvedor do
Firefox (`about:debugging` → "Carregar add-on temporário"). Não há dependência de
infraestrutura.

## Smoke manual (AE1–AE8)

Pendente de execução em Firefox com o YouTube real. Este é o único teste do
comportamento contra o YouTube ao vivo; automação contra o site real está fora do
escopo.

- [ ] AE1 — vídeo assistido sem exceção: sem interação por 5s, o próximo vídeo sugerido toca.
- [ ] AE2 — clicar no popup cancela o skip e o vídeo toca.
- [ ] AE3 — marcar "nunca pular" grava a exceção; reabrir não mostra popup.
- [ ] AE4 — vídeo abandonado abaixo do limiar não é catalogado.
- [ ] AE6 — sem login, detecção e skip funcionam.
- [ ] AE5 / AE7 / AE8 — exigem dois dispositivos (ou dois perfis) e backend; ver `server/deploy/README.md`.
