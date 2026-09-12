# Extras

## Stretch goals

Not part of the plan — worth trying only once the core phases are done.

| Idea | Why it's a stretch, not a phase |
| :--- | :--- |
| Kubernetes | compose covers what this project needs; K8s is a different lesson |
| GraphQL | REST already serves the gateway; a second query layer adds nothing new here |
| gRPC | Fine between services later; REST/HTTP is enough while there's no latency problem to solve |
| Long polling | No feature yet needs a live-updating screen |
| WebSockets | Same as long polling — add when something needs to push, not pull |
| Service mesh | Solves problems this project doesn't have yet |
| Separate auth provider (Auth0/Keycloak) | Directory issuing tokens teaches the same lesson with fewer moving parts |
| BFF (backend-for-frontend) | Gateway already fills this role for one frontend; worth it only with a second client (mobile) needing a different shape |
| Sidecars | A per-service proxy for cross-cutting concerns (mTLS, metrics) — only pays off once service mesh does |
| Offline-first sync | Needs a client app first. Its server half — client ids, occurrence timestamps — is already decided in phase 1 |
| Service registry / discovery | Compose DNS already is the registry; the pattern resolves to "use the hostname" |
| Postgres as a job queue | Redis and Kafka already cover every queue this project has |
| Blue-green deploys | Needs a real deploy pipeline first; compose restarts are enough while there's no uptime SLA to protect |

