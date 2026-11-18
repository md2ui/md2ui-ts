# patches/

Changes to dependencies that md2ui-ts needs before their maintainers release them, applied by
pnpm (`patchedDependencies` in `pnpm-workspace.yaml`). Each is offered upstream, and goes
once a release carries it.

| Patch | What it changes | Why |
|---|---|---|
| `@chenglou__pretext@0.0.9.patch` | one measuring canvas context per font string, its font set once | Firefox slows down in a Worker every time the measuring font changes; measured widths are unchanged |

A pnpm patch exists only in this workspace: npm gives a host the registry's copy. So the
package that uses a patched dependency bundles it into its build, with the dependency's
licence in its `THIRD_PARTY_NOTICES.md`, and `pnpm packages shape` (`scripts/patched.ts`)
fails a published package that would reach one through npm. The rule, its trade-off and its
exit condition are in ADR-007; the upstream change for Pretext is in
[`pretext-upstream.md`](pretext-upstream.md).
