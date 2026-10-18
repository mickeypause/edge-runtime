import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

assert(process.argv.length <= 3 && (!process.argv[2] || process.argv[2] === '--diagnose'), 'Usage: node run.mjs [--diagnose]');
const diagnose = process.argv[2] === '--diagnose';
const binary = process.env.EDGE_RUNTIME;
assert(binary, 'Set EDGE_RUNTIME to an absolute edge-runtime executable path');
assert(binary.startsWith('/'), 'EDGE_RUNTIME must be absolute');
await access(binary);
const root = fileURLToPath(new URL('.', import.meta.url));
await mkdir(`${root}.runs`, { recursive: true });
const output = await mkdtemp(`${root}.runs/run-`);
console.log(`Evidence: ${output}`);
const results = [];

for (const reload of [true, false]) {
  for (let round = 1; round <= 3; round++) {
    // Refuse to send test requests to another process already using this port.
    const listener = createServer();
    listener.listen(19371, '127.0.0.1');
    await once(listener, 'listening');
    await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));

    const name = `${reload ? 'reload' : 'use'}-${round}`;
    const dir = `${output}/${name}`;
    await mkdir(`${dir}/cache`, { recursive: true });
    const log = createWriteStream(`${dir}/runtime.log`);
    const child = spawn(binary, [
      'start', '--ip', '127.0.0.1', '--port', '19371',
      '--main-service', `${root}main`, '--policy', 'oneshot',
      '--request-wait-timeout', '10000',
    ], {
      cwd: root,
      env: { ...process.env, DENO_DIR: `${dir}/cache`, RELOAD: String(reload), FUNCTION_PATH: `${root}function` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    let spawnError;
    const done = new Promise(resolve => {
      child.once('error', error => { spawnError = error; resolve(); });
      child.once('close', resolve);
    });
    const request = async (index = 0) => {
      const start = Date.now();
      try {
        const response = await fetch(`http://127.0.0.1:19371/${index % 3}`, { signal: AbortSignal.timeout(15000) });
        return { status: response.status, body: await response.text(), ms: Date.now() - start };
      } catch (error) {
        return { error: String(error), ms: Date.now() - start };
      }
    };
    try {
      let ready = false;
      for (let i = 0; i < 1200; i++) {
        if (spawnError || child.exitCode !== null || child.signalCode !== null) break;
        try {
          const response = await fetch('http://127.0.0.1:19371/health', { signal: AbortSignal.timeout(1000) });
          ready = response.ok && await response.text() === 'ready';
        } catch {}
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(ready, `Runtime did not start: ${spawnError ?? dir + '/runtime.log'}`);
      const cold = await Promise.all(Array.from({ length: 15 }, (_, i) => request(i)));
      await writeFile(`${dir}/cold.json`, JSON.stringify(cold, null, 2));
      const serial = [await request()];
      const warm = await Promise.all(Array.from({ length: 15 }, (_, i) => request(i)));
      const result = { name, reload, round, cold, serial, warm };
      results.push(result);
      await writeFile(`${dir}/responses.json`, JSON.stringify(result, null, 2));
      console.log(name, Object.fromEntries(['cold', 'serial', 'warm'].map(phase => [
        phase, `${result[phase].filter(r => r.status === 200 && r.body === 'ok').length}/${result[phase].length} OK`,
      ])));
    } finally {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await done;
      clearTimeout(timer);
      const flushed = once(log, 'finish');
      log.end();
      await flushed;
    }
  }
}

await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
const healthy = r => [...r.cold, ...r.serial, ...r.warm].every(x => x.status === 200 && x.body === 'ok');
assert(results.filter(r => !r.reload).every(healthy), 'Cache-use control failed; inspect evidence');
if (diagnose) {
  const reloadLogs = await Promise.all(results.filter(r => r.reload).map(r => readFile(`${output}/${r.name}/runtime.log`, 'utf8')));
  assert(reloadLogs.some(log => /failed to unpack[^\n]*File exists \(os error 17\)/.test(log)), 'Exact npm extraction EEXIST did not reproduce; timeouts alone are insufficient');
  console.log('Confirmed npm extraction EEXIST with reload enabled; all cache-use controls passed.');
} else {
  assert(results.every(healthy), 'Concurrent worker regression: expected HTTP 200/body ok for every request; inspect evidence');
}
