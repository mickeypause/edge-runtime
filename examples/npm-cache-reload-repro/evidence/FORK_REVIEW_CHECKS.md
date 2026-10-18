# Fork review checks

These checks exercise the published harness against the separately downloaded, checksum-verified official native v1.77.4-r0 executable on macOS arm64. No patched runtime was built or tested.

| Command | Exit | Meaning |
| --- | --- | --- |
| `node --check run.mjs` | 0 | Node syntax valid |
| `EDGE_RUNTIME=/absolute/path/to/edge-runtime node run.mjs --diagnose` | 0 | Exact npm extraction EEXIST confirmed; all cache-use controls healthy |
| `EDGE_RUNTIME=/absolute/path/to/edge-runtime node run.mjs` | 1, expected | Regression caught failed concurrent requests on the affected release |

## Complete current-run response counts

- fork-diagnostic, noModuleCache=true: `{"EEXIST": 9, "ENOENT": 3, "ok": 36, "timeout": 42}`
- fork-diagnostic, noModuleCache=false: `{"ok": 90}`
- fork-regression, noModuleCache=true: `{"EEXIST": 10, "ENOENT": 2, "ok": 39, "timeout": 39}`
- fork-regression, noModuleCache=false: `{"ok": 90}`

All six serial requests in each invocation returned HTTP 200/body `ok`. Every cache-use control request succeeded. Statuses, response bodies, timings and all six runtime logs for each invocation are retained alongside this file. Absolute local example-directory prefixes were replaced with `<repro>`.

The regression assertion was:

```text
Concurrent worker regression: expected HTTP 200/body ok for every request; inspect evidence
```

The diagnostic run requires the exact `failed to unpack ... File exists (os error 17)` log signature, so generic worker timeouts cannot make it pass. The regression run is deliberately red on the affected release; this is validation of the test, not a claimed fixed build.

Published harness SHA256: `08bb9dcf1c37124b3269db582b3fbb94a4403564879a14a9b33449c1e193e5c9`.

No production runtime code changed. No full Rust build/test suite, Linux/container execution, or hosted validation was run.
