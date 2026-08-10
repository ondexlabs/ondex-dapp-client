import { serve } from '@hono/node-server';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { paymentMiddleware } from '@x402/hono';
import { ExactXrplScheme } from '@x402/xrpl/exact/server';
import { Hono } from 'hono';

const payTo = process.env.XRPL_PAYEE_ADDRESS;
const facilitatorUrl = process.env.FACILITATOR_URL;
if (!payTo || !facilitatorUrl) throw new Error('XRPL_PAYEE_ADDRESS and FACILITATOR_URL are required');

const origin = process.env.MERCHANT_ORIGIN ?? 'http://localhost:3005';
const asset = process.env.XRPL_ASSET ?? 'XRP';
const issuer = process.env.XRPL_ISSUER;
const amount = process.env.XRPL_AMOUNT ?? '1000';
if (asset !== 'XRP' && !issuer) throw new Error('XRPL_ISSUER is required for issued assets');

const accepts = {
  payTo,
  scheme: 'exact',
  network: 'xrpl:1',
  price: {
    amount,
    asset,
    extra: { assetTransferMethod: 'sequence', ...(issuer ? { issuer } : {}) },
  },
};
const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl }))
  .register('xrpl:*', new ExactXrplScheme());
const app = new Hono();

app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, PAYMENT-SIGNATURE');
  c.header('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});
app.use('*', paymentMiddleware({
  'GET /paid/report': { accepts },
  'POST /paid/report': { accepts },
  'GET /paid/handler-failure': { accepts },
}, resourceServer));

app.get('/health', (c) => c.json({ ok: true, network: 'xrpl:1', profile: 'foundation-xrpl-exact-v2-sequence' }));
app.get('/paid/report', (c) => c.json({ report: 'Fixture resource delivered', method: 'GET' }));
app.post('/paid/report', async (c) => c.json({ report: 'Fixture resource delivered', method: 'POST', input: await c.req.json().catch(() => null) }));
app.get('/paid/handler-failure', (c) => c.json({ error: 'Fixture handler failed after payment verification' }, 503));

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4021) }, (info) => {
  console.log(`x402 merchant fixture listening on http://localhost:${info.port}`);
});
