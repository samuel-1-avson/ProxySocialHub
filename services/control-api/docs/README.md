# Legacy Swagger 2.0 Artifacts

This directory contains generated Swagger 2.0 output from `swaggo/swag`.

For the public-testnet release-candidate sprint:

- [docs/openapi.yaml](../../../docs/openapi.yaml) is the only authoritative public API contract.
- this directory is non-authoritative for QA, frontend integration, release review, and external builder documentation.
- runtime behavior is still defined by live route and handler code, not by these generated files.

Do not point new public-facing tooling or reviews at this directory.

If internal backend tooling still needs these files, treat them as legacy generated artifacts only. Future contract automation should either replace this tree with [docs/openapi.yaml](../../../docs/openapi.yaml) generation or retire the tree entirely, but it should not leave two competing public contract sources in active use.

Public contract source: [docs/openapi.yaml](../../../docs/openapi.yaml). ADRs: [docs/adr/](../../../docs/adr/).
