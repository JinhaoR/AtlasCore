# Developer guide

Start with [development.md](development.md) for commands, code ownership and
which tests to run. [AGENTS.md](../AGENTS.md) gives the working rules for Codex.

| Topic | Read |
| --- | --- |
| Product rules and Core | [Foundation](foundation.md), [architecture](architecture.md) |
| Firefox integration | [Extension guide](../extension/README.md), [adapter](firefox-adapter.md) |
| Sites, drafts and Vault | [Draft editing](destination-polish.md), [scope rules](whitelist-scopes.md), [removals](whitelist-removal.md) |
| Home and bookmarks | [Home](home-organization.md), [everyday controls](everyday-controls.md) |
| Storage and recovery | [Reliability](firefox-storage-reliability.md), [backup](firefox-backup.md) |
| Colors, compass and your backgrounds | [Theme folder guide](../themes/README.md), [theme contract](themes.md) |
| Releases | [Version history](version-history.md), [release procedure](firefox-private-release.md) |

Version history is kept in one file. Feature contracts remain separate because
they describe behavior that code, migrations and tests still rely on. Dated
investigations and sanitized evidence record what was actually checked; they
are not instructions to restart old development work.

Repository cleanup decisions and current validation are recorded in
[repository-cleanup.md](repository-cleanup.md).
