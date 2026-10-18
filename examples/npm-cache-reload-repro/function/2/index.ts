import { z } from 'npm:zod@4.4.3';
Deno.serve(() => new Response(z.string().parse('ok')));
