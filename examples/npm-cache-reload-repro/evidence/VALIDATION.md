# Findings validated independently of Vox

## Scope and environment

- Date: 2026-10-18; macOS 26.6.2 (25G83), arm64; Node v24.13.0.
- Supabase CLI latest stable: 2.121.0, released 2026-10-14. The standalone reproduction bypasses the CLI entirely.
- Edge Runtime latest stable: 1.77.4; official native archive revision v1.77.4-r0.
- Archive SHA256: `c0a16266b5208caec6669a982076575492c46f4d999748cdb7f3eb1dccbd6e39`.
- Native manifest source commit: `d4a4f606a90e8c66864219c9b1d31ef0e3e3f626`.
- Underlying binary SHA256: `b332625d8c1be88b192718d8d6d4510bf568261915daf0d66363ec6f7a97bf55`.
- Fresh official download matched both the existing native binary and its wrapper byte-for-byte. Final run uses this separate download.

No Vox source, credentials, database, Auth, client SDK, app, Metro, or patched CLI is needed. One npm package and three tiny function paths suffice.

## Completed exploratory comparison

`matrix-1/results.json` and `matrix-1/bounded-*/` retain every result from three independent processes/cache directories per setting, before the final standalone rerun:

| noModuleCache | Cold parallel HTTP 200 | Retained-cache parallel HTTP 200 | Serial HTTP 200 |
| --- | --- | --- | --- |
| true, round 1 | 12/15 | 7/15 | 1/1 |
| true, round 2 | 11/15 | 7/15 | 1/1 |
| true, round 3 | 12/15 | 5/15 | 1/1 |
| false, round 1 | 15/15 | 15/15 | 1/1 |
| false, round 2 | 15/15 | 15/15 | 1/1 |
| false, round 3 | 15/15 | 15/15 | 1/1 |

Reload enabled: 36/90 concurrent requests failed. Disabling reload: 90/90 concurrent requests and 3/3 serial requests passed. Among the 36 failures were 3 exact EEXIST responses, 6 ENOENT responses, 1 ERR_MODULE_NOT_FOUND, and 26 worker-acquisition timeouts. Do not describe all 36 as extraction errors.

Representative error, retained in `bounded-reload-3/responses.json`:

```text
InvalidWorkerCreation: worker boot error: failed to bootstrap runtime: failed to create the graph: Failed caching npm package 'zod@4.4.3'.
    0: failed to unpack ...: File exists (os error 17)
```

Other workers failed reading files from that same package directory with `No such file or directory (os error 2)`. This also occurs after the first burst has completed, so it is not solely an initially empty-cache phenomenon.

The initial single-function-path experiment reproduced worker-acquisition timeouts but no exact extraction error; its full three-round results are `initial-results.json`. This is a useful negative result. A three-path, 90-second-timeout trial reproduced exact extraction/missing-file errors, but was deliberately stopped before its full response matrix finished; its log and exact script are retained under `interrupted-long-timeout/` and `long-timeout-run.mjs`. It is excluded from completed-run counts. Final matrix restores the normal 10-second worker-acquisition timeout, while identifying exact cache errors separately from timeouts.

## Source evidence and bounded interpretation

1. [CLI 2.121.0 native bootstrap](https://github.com/supabase/cli/blob/v2.121.0/packages/stack/src/functions/serve.main.ts#L463) sets `noModuleCache: true`.
2. [Edge Runtime 1.77.4](https://github.com/supabase/edge-runtime/blob/v1.77.4/crates/base/src/runtime/mod.rs#L547) maps that flag to `CacheSetting::ReloadAll`, versus `Use` for false.
3. [Emitter npm resolver](https://github.com/supabase/edge-runtime/blob/v1.77.4/crates/deno_facade/emitter.rs#L379) passes the cache strategy to npm resolution.
4. Its [pinned Cargo.lock](https://github.com/supabase/edge-runtime/blob/v1.77.4/Cargo.lock) uses `deno_npm_cache` 0.2.0. The pinned source is published at https://docs.rs/crate/deno_npm_cache/0.2.0/source/tarball.rs and https://docs.rs/crate/deno_npm_cache/0.2.0/source/tarball_extract.rs; its archive checksum in Cargo.lock is `4c5f2a9b36fd011cec755780a2ca68e0ed5ec829c747b2d4912495641bc74f77`. `tarball.rs` chooses `Overwrite` for a reload of an existing package. `tarball_extract.rs` extracts directly into that directory; the cache-use path uses a sibling temporary directory and rename.

These observations strongly support overlapping npm extraction/reload as the cause. The one-variable runtime comparison validates that disabling forced reload avoids this reproduction. It does not prove a general concurrency fix in Rust, guarantee arbitrary dependency graphs, or establish hosted production impact. There has been no syscall-level tracing of this npm race and no runtime patch has been built. The Vox workaround includes eager startup and sequential warming as well; their separate necessity is not established here.

## Duplicate and related-issue search

Searched GitHub issues and PRs in `supabase/cli`, `supabase/edge-runtime`, `denoland/deno`, and `denoland/deno_cache_dir`, plus Supabase-wide exact-error queries. Terms included failed caching npm package, failed to unpack, File exists, os error 17, EEXIST, noModuleCache, reload, npm cache, concurrent, race, extraction, and tarball. `github-search.json` records 20 queries, counts, incomplete-results flags, and up to 100 results each; other targeted queries and web search were also reviewed. Broad query result sets are capped, so this is evidence of no matching report found, not a guarantee none exists. GitHub search may omit unindexed content and Discussions.

- [Edge Runtime #746](https://github.com/supabase/edge-runtime/issues/746), fixed by [#747](https://github.com/supabase/edge-runtime/pull/747): confirmed cold-cache concurrency bug in SQLite initialization, with SIGBUS and database replacement. Already fixed before 1.77.4; distinct failure mechanism from npm tarball EEXIST.
- [Edge Runtime #408](https://github.com/supabase/edge-runtime/issues/408): worker scheduling, oneshot/per_worker throughput and acquisition timeouts. Explains why timeout-only evidence is insufficient; does not identify the npm extraction failure.
- [Deno #36943](https://github.com/denoland/deno/issues/36943): open proposal for cross-process cache/build-output locks. Related concurrency concern, not a confirmed duplicate of this same-process Edge Runtime failure.
- [Deno #23759](https://github.com/denoland/deno/pull/23759): historical temp-directory-and-rename extraction improvement. The pinned library has that behavior, but deliberately uses overwrite when reloading an existing package.
- [Deno #26180](https://github.com/denoland/deno/issues/26180): missing cached JSR exports/platform-specific packages; different reproduction and root cause.
- [Deno #31489](https://github.com/denoland/deno/issues/31489): read-only npm executable permissions; different EACCES failure, resolved in newer Deno.
- Edge Runtime #728/#729/#730 concern a build-time tests/.env creation race; unrelated.

No exact duplicate was found. Based on the independent runtime reproduction, `supabase/edge-runtime` would be the strongest primary report location; the native CLI's forced reload should be linked as the trigger. Maintainers may choose to fix or mitigate it in the CLI and/or its pinned npm cache library.

## Limits and state

Only native macOS arm64 was tested. Linux, Docker runtime, current standalone Deno, and Supabase-hosted execution have not been tested. Network access is required, although explicit filesystem errors plus the successful cache-use controls distinguish this from a simple network outage. The first attempt using the freshly downloaded executable exceeded the original 20-second process-readiness window before producing logs (no runtime logs were produced). A subsequent `--version` completed successfully. The final harness allows 120 seconds for process readiness; this setup failure is retained and excluded from HTTP result counts. Its cause was not investigated. No claim about cross-platform prevalence or a universal fix is justified yet.

This document records the completed local investigation before publication to a review-only fork. No upstream issue or PR has been submitted. Local absolute reproduction-directory prefixes in the published JSON/logs were replaced with `<repro>`; status codes, error text, timings and package paths are otherwise preserved. The standalone harness is adapted for publication; the recorded matrices used the earlier local harness. Vox tracked files and remote branches were left unchanged.

## Final rerun from the independently downloaded archive

`matrix-2/results.json` records the final run. `node run.mjs` exited 0 after both diagnostic assertions passed.

| Setting / round | Cold parallel HTTP 200 | Retained-cache parallel HTTP 200 | Serial HTTP 200 |
| --- | --- | --- | --- |
| Reload / 1 | 9/15 | 14/15 | 1/1 |
| Reload / 2 | 11/15 | 9/15 | 1/1 |
| Reload / 3 | 12/15 | 11/15 | 1/1 |
| Cache use / 1 | 15/15 | 15/15 | 1/1 |
| Cache use / 2 | 15/15 | 15/15 | 1/1 |
| Cache use / 3 | 15/15 | 15/15 | 1/1 |

Final rerun: reload enabled had 24/90 concurrent failures (1 EEXIST, 7 ENOENT, 16 worker-acquisition timeouts). Cache use passed 90/90 concurrent requests and 3/3 serial requests.

Across both completed three-round matrices, reload enabled failed 60/180 concurrent requests; cache use passed 180/180 concurrent requests. Both matrices independently reproduced the exact npm extraction EEXIST signature. All twelve serial requests passed. No failed trial was silently retried or omitted; the separate setup failure and interrupted long-timeout experiment remain documented above.
