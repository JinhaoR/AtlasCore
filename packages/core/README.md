# AtlasCore

One pure TypeScript package, consumed by Firefox through `@atlas/core`.
The public surface is [`src/index.ts`](src/index.ts); imports point inward to
Core modules, never to the extension, themes, DOM, browser APIs or concrete I/O.

| Modules in `src/` | Owner |
| --- | --- |
| `target`, `policy`, `evaluate`, `managed-blacklist` | Normalization, complete policy validation and classification/precedence |
| `access*`, `vault*`, `journey*`, `download` | Domain workflows with explicit supplied time and frozen scopes/deadlines |
| `atlas-models`, `atlas-state`, `atlas-planner`, `atlas-equality` | Complete aggregate, validation, pure planning and validated-data comparison |
| `atlas-controller`, `atlas-controller-models`, `atlas-ports` | Serialized commands, injected repository/clock, atomic CAS, commit-before-publication and unknown-outcome reconciliation |
| `configuration`, `models` | Validated configuration and shared domain types |

A pure transition or candidate is never proof of persistence. Concrete clocks,
IndexedDB and browser event correlation live in the Firefox extension. Core has
no runtime dependencies and does not implement authentication or networking.

```ts
import { evaluate, type Policy } from "@atlas/core";
const policy: Policy = { whitelist: ["mail.example"], blacklist: [] };
evaluate("https://mail.example/messages", policy); // ALLOW / WHITELISTED
evaluate("unknown.example", policy); // GREYLIST / UNLISTED
```

`evaluate` classifies policy; grants and Journeys belong to their workflows and
aggregate planner/controller. Defaults remain exact hosts; optional saved scopes,
Blacklist precedence, explicit confirmations and storage semantics are specified
in [architecture](../../docs/architecture.md) and [foundation](../../docs/foundation.md).

```sh
npm --prefix packages/core run typecheck
npm --prefix packages/core test
```

Tests use explicit time and fake repositories. `test` builds first;
`test:built` runs against an already-current `dist/`. No browser is required.
