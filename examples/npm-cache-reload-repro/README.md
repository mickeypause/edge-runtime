# Concurrent npm cache reload reproduction

Review-only reproduction of npm extraction failures in native Edge Runtime
v1.77.4-r0. This example changes no runtime implementation.

Three identical two-line handlers import only `npm:zod@4.4.3`. The main service
creates a fresh worker per request. There is no Supabase project, database,
Auth, Docker, app code, or account requirement.

## Run

Requires Node 24, network access to npm, and a free localhost port 19371.
The recorded environment is macOS 26.6.2 on Apple silicon.

From this directory, download the same official native runtime used for the
recorded results, verifying the pinned archive checksum:

```sh
curl -fL https://github.com/supabase/slim-services/releases/download/edge-runtime-v1.77.4-r0/edge-runtime-v1.77.4-r0-darwin-arm64.tar.zst -o edge-runtime.tar.zst
echo 'c0a16266b5208caec6669a982076575492c46f4d999748cdb7f3eb1dccbd6e39  edge-runtime.tar.zst' | shasum -a 256 -c -
mkdir -p runtime
tar -xf edge-runtime.tar.zst -C runtime
EDGE_RUNTIME="$PWD/runtime/bin/edge-runtime" node run.mjs --diagnose
```

Diagnostic mode succeeds only when the reload-enabled cases log the exact
`failed to unpack ... File exists (os error 17)` signature and every cache-use
control returns HTTP 200 with body `ok`. Timeouts alone do not confirm the bug.
The race is timing-sensitive, so a run without that exact signature fails the
diagnostic assertion and must not be presented as confirmation.

The same harness is also a regression check for a candidate runtime fix:

```sh
EDGE_RUNTIME=/absolute/path/to/candidate/edge-runtime node run.mjs
```

Without `--diagnose`, every request in both groups must succeed. This command
is expected to fail against the affected official release. No fixed runtime
binary is included or claimed to have been tested.

Each invocation writes `.runs/run-*/`, with a new DENO_DIR for every case. The
script binds only 127.0.0.1, checks that its port is free, and stops its own
runtime after each case. It leaves the logs and generated caches for inspection;
it never deletes the user's existing Supabase cache. Run one copy at a time.
After an interrupted invocation, stop only its remaining child process before
re-running. Generated runs, binaries and downloads are gitignored.

## Test matrix

For each `noModuleCache` value, three independent cases run the same sequence:

1. Start a new runtime with an empty cache.
2. Send 15 parallel requests across three distinct function paths.
3. Send one serial request.
4. Send another 15 parallel requests against the retained cache.

Settings: `oneshot`, `forceCreate: true`, 150 MiB worker memory, 60-second worker
lifetime, 10-second worker-acquisition timeout, 15-second HTTP deadline.
Changing `noModuleCache` is the only difference between the two groups.

The archived validation matrices recorded 60/180 concurrent failures with reload
enabled, versus 180/180 successful concurrent requests with cache use. Failures
include extraction EEXIST, missing files and worker timeouts; these are counted
separately in [the validation report](evidence/VALIDATION.md).

Raw responses and runtime logs are under `evidence/matrix-1/` and
`evidence/matrix-2/`. The report also records negative and interrupted experiments,
artifact provenance, source references and the duplicate search. Only absolute
local reproduction-directory prefixes were replaced with `<repro>`.

## Interpretation and proposed next step

The CLI native bootstrap forces `noModuleCache: true`; the runtime maps it to
`ReloadAll` and passes it through to the npm resolver. The pinned npm cache
library overwrites existing package files on reload. Overlapping extraction is
consistent with the observed EEXIST and missing-file failures.

Setting `noModuleCache: false` is a validated control/workaround in this fixture.
It is not a tested runtime patch. A fix should prevent concurrent package
extraction from disturbing files another worker is reading while preserving
intended reload behavior. Candidates include coordinating package reloads in
the cache library, or separately defining remote-source and immutable npm
package cache policies. Merely disabling all reloads changes semantics and
should not be presented as a proven general fix.

Only native macOS arm64 is validated. Linux, container execution, standalone
Deno and hosted Supabase impact are unverified. No full Rust build or test suite
is required for this standalone reproduction, and none has been run for this PR.
