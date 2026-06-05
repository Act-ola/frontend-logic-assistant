# Architecture

## Principle

Frontend Logic Assistant is evidence-first. Every answer is generated from indexed code facts and returns source files plus snippets. If the analyzer cannot find enough evidence, the answer should say so instead of inventing business logic.

## Modules

- `apps/web`: Next.js internal workbench and API routes.
- `packages/analyzer`: JS/JSX parser, logic fact extraction, retrieval, and local answer synthesis.
- `packages/shared`: Shared schemas and TypeScript types.
- `sample-repos/order-admin-demo`: Demo React repository used for local validation.

## Flow

1. A project config points to one React repository root.
2. The analyzer scans `.js/.jsx/.ts/.tsx` files with Babel.
3. It extracts facts: conditional rendering, API calls, state, Context, MobX, and event handlers.
4. API routes persist the generated index under `.logic-assistant/indexes`.
5. The ask API retrieves facts and either:
   - uses deterministic local synthesis, or
   - calls AI SDK Gateway when `AI_MODE=gateway`.

## Current Boundaries

The first version favors trustworthy evidence over perfect static analysis. It does not execute code, resolve every runtime value, or claim complete business truth. It gives product and QA a fast explanation path with source references.
