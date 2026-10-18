Deno.serve(async (req) => {
  if (new URL(req.url).pathname === '/health') return new Response('ready');
  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: Deno.env.get('FUNCTION_PATH'),
      noModuleCache: Deno.env.get('RELOAD') === 'true',
      forceCreate: true,
      memoryLimitMb: 150,
      workerTimeoutMs: 60000,
      envVars: [],
    });
    return await worker.fetch(req);
  } catch (error) {
    console.error(error);
    return new Response(String(error), { status: 503 });
  }
});
