import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('.', import.meta.url));
const binary = process.env.EDGE_RUNTIME;
assert(binary, 'Set EDGE_RUNTIME to the official native edge-runtime executable');
const results = [];
for (const reload of [true, false]) {
  for (let round = 1; round <= 3; round++) {
    const name = `${reload ? 'reload' : 'use'}-${round}`;
    const dir = `${root}evidence/${name}`;
    await mkdir(`${dir}/cache`, { recursive: true });
    const log = createWriteStream(`${dir}/runtime.log`);
    const child = spawn(binary, ['start', '--ip', '127.0.0.1', '--port', '19371', '--main-service', `${root}main`, '--policy', 'oneshot'], {
      cwd: root,
      env: { ...process.env, DENO_DIR: `${dir}/cache`, RELOAD: String(reload), FUNCTION_PATH: `${root}function` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(log); child.stderr.pipe(log);
    const done = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
    const request = async () => {
      const start = Date.now();
      try {
        const response = await fetch('http://127.0.0.1:19371/test', { signal: AbortSignal.timeout(90000) });
        return { status: response.status, body: await response.text(), ms: Date.now() - start };
      } catch (error) { return { error: String(error), ms: Date.now() - start }; }
    };
    try {
      let ready = false;
      for (let i = 0; i < 200; i++) {
        try { ready = (await fetch('http://127.0.0.1:19371/health')).ok; } catch {}
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(ready, 'Runtime did not start');
      const cold = await Promise.all(Array.from({length: 15}, request));
      const serial = [];
      for (let i = 0; i < 3; i++) serial.push(await request());
      const warm = await Promise.all(Array.from({length: 15}, request));
      const result = { name, reload, round, cold, serial, warm };
      results.push(result);
      await writeFile(`${dir}/responses.json`, JSON.stringify(result, null, 2));
      console.log(name, JSON.stringify(Object.fromEntries(['cold','serial','warm'].map(key => [key, result[key].reduce((a,r) => { const k=r.status ?? r.error; a[k]=(a[k]||0)+1; return a; },{})]))));
    } finally {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await done; clearTimeout(timer); log.end();
    }
  }
}
await writeFile(`${root}evidence/results.json`, JSON.stringify(results, null, 2));
