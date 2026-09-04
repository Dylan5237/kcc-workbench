# Arckeep Design Authority Status

Status: **DESIGN RESET / NO NEW SYSTEM FROZEN**

Effective date: 2026-09-04

## Decision

The user has explicitly rejected the current Arckeep design system as the forward visual authority.

Therefore the following existing assets remain valuable historical/product-design references, but they are **not mandatory visual authority for new D0 implementation**:

- `docs/brand/**`
- `docs/prototypes/arckeep-visual-v0.4.html`
- visual styling/tokens derived from those sources in the current `arckeep/ui/`

Do not delete these assets. They preserve design history and may contain reusable ideas.

## Current authority

No replacement comprehensive design system is frozen yet.

For D0, product/visual implementation should prioritize the real Daily Driver surfaces and follow this order:

1. correct information architecture;
2. clear current-project context;
3. fast, persistent workspace switching;
4. coherent hierarchy among Project / Solo / Viewer;
5. readable spacing and information density;
6. controlled startup/failure states;
7. visual convergence after real-machine screenshots and dogfood feedback.

Do not build a design-system framework before these product surfaces are real.

## Embedded/native surfaces

KimiCode, ClaudeCode visual workspace, and DSH are reused/native work surfaces.

Arckeep should provide coherent surrounding navigation, context and lifecycle chrome without reimplementing each embedded tool merely to force visual uniformity.

## Acceptance ownership

Coding Agents may implement presentation according to written instructions but do not self-approve visual quality.

- real screenshots / operation: User
- visual and product review: User + ChatGPT
- implementation repair instructions: written by ChatGPT and sent to the Product UI Engineer

## Next design milestone

After D0 functional surfaces exist, perform a real-product visual review and freeze only the minimum design decisions proven useful by that review.
