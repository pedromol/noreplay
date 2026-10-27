# Plan: Translate all project documentation to English

**Date:** 2026-10-27  
**Type:** chore/docs  
**Scope:** All project documentation files (excluding node_modules)

## Objective

Translate all Portuguese/mixed-language documentation to English while preserving technical accuracy, structure, commands, and references. Keep code blocks, file paths, CLI commands, and technical terms unchanged.

## Files to translate

| File | Current state | Notes |
|---|---|---|
| `README.md` | Mixed PT/EN (mostly Portuguese intro/sections) | Main project overview |
| `AGENTS.md` | English | Already in English - review only if needed |
| `extension/README.md` | Unknown/mixed | Extension-specific docs |
| `server/README.md` | Unknown/mixed | Server setup/run instructions |
| `server/deploy/README.md` | Unknown/mixed | Deployment instructions |
| `docs/plans/2026-10-16-1238-feat-youtube-watch-skip-plan.md` | English | Already in English |
| `docs/plans/2026-10-17-0811-feat-youtube-history-import-plan.md` | English | Already in English |
| `docs/plans/2026-10-17-0852-feat-hide-watched-videos-plan.md` | English | Already in English |
| `docs/plans/2026-10-17-1504-feat-shorts-support-plan.md` | English | Already in English |

*Note:* AGENTS.md and existing plans appear to be in English already. Focus on README.md and any Portuguese content in subdirectory READMEs.

## Translation guidelines

- **Preserve structure:** Keep headings, lists, code blocks, and markdown formatting identical
- **Keep technical terms:** Don't translate MV3, SQLite, WAL, argon2id, SHA-256, TTL, CGO, ES modules, background.scripts, service workers, etc.
- **Preserve commands:** All shell commands, npm/go/docker/kubectl commands must remain unchanged
- **Preserve paths:** File paths, URLs, and references unchanged
- **Preserve code:** Code snippets, JSON, YAML unchanged
- **Natural English:** Use clear, technical English appropriate for developer documentation
- **Maintain cross-references:** Update internal links if anchor text changes, but keep link targets the same
- **Preserve tone:** Keep concise and direct style matching existing English docs

## Implementation steps

1. **Inventory** - Read all target files to confirm language and identify Portuguese sections
2. **Translate README.md** - Translate Portuguese sections to English (structure, objectives, affinities, verification)
3. **Translate subdirectory READMEs** - Check and translate `extension/README.md`, `server/README.md`, `server/deploy/README.md`
4. **Review** - Ensure consistency with AGENTS.md terminology and project voice
5. **Verify** - Check markdown syntax, links, code blocks intact
6. **Test** - Run extension lint/tests and server checks as per AGENTS.md verification before commit

## Verification

Before committing (per AGENTS.md):
```bash
# Extension
cd extension && npm test && npm run lint && npm run lint:manifest

# Server  
cd server && go test ./... && go vet ./...
```

## Success criteria

- [ ] All project documentation is in English
- [ ] No translation errors in technical terms or commands
- [ ] Markdown formatting preserved
- [ ] All cross-references intact
- [ ] Verification commands pass
- [ ] Follows conventional commit format: `docs: translate all documentation to English`

## Notes

- AGENTS.md is the source of truth for invariants - keep it unchanged unless it's already English and correct
- Existing plans in `docs/plans/` are preserved per AGENTS.md rule
- Focus on user-facing docs (READMEs) that have Portuguese content
