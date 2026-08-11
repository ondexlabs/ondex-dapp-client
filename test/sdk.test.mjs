import assert from "node:assert/strict";
import {
  buildOndexSignInRequest,
  buildOndexUniversalConnectLink,
  buildOndexWalletConnectLink,
  createOndexPayload,
  normalizePushServerUrl,
  pollOndexPayloadStatus,
  resolveOndexPayloadStatusUrl,
  verifyOndexSignInResponse,
  ondexX402Fetch,
} from "../dist/index.js";

const wcUri = "wc:abc@2?relay-protocol=irn&symKey=secret";

assert.equal(
  buildOndexWalletConnectLink(wcUri),
  "ondex://wc?uri=wc%3Aabc%402%3Frelay-protocol%3Dirn%26symKey%3Dsecret",
);

assert.equal(
  buildOndexUniversalConnectLink(`wc://${wcUri.slice(3)}`, { siteUrl: "https://ondex.money", universalPath: "/connect" }),
  "https://ondex.money/connect?uri=wc%3Aabc%402%3Frelay-protocol%3Dirn%26symKey%3Dsecret",
);

assert.equal(
  resolveOndexPayloadStatusUrl("/api/v1/payloads/123", "https://push.ondex.money"),
  "https://push.ondex.money/api/v1/payloads/123",
);

assert.equal(
  resolveOndexPayloadStatusUrl("https://push.ondex.money/api/v1/payloads/123", "https://push.ondex.money"),
  "https://push.ondex.money/api/v1/payloads/123",
);

assert.throws(
  () => resolveOndexPayloadStatusUrl("https://example.com/api/v1/payloads/123", "https://push.ondex.money"),
  /configured push server origin/,
);

{
  const required = {
    x402Version: 2,
    resource: { url: 'https://merchant.example/report' },
    accepts: [{ scheme: 'exact', network: 'xrpl:0', amount: '1', asset: 'XRP', payTo: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe', maxTimeoutSeconds: 60, extra: { areFeesSponsored: false } }],
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
  let signatures = 0;
  const reports = [];
  const calls = [];
  const provider = {
    beginInteraction: async () => ({ interactionToken: 'interaction', expiresAt: new Date(Date.now() + 10_000).toISOString() }),
    createPaymentPayload: async ({ paymentRequired }) => {
      signatures += 1;
      assert.deepEqual(paymentRequired, required);
      return { intentId: 'intent-1', paymentPayload: { x402Version: 2, resource: required.resource, accepted: required.accepts[0], payload: { signedTxBlob: 'ABCD' } } };
    },
    getIntentStatus: async () => ({ expectedTxHash: 'A'.repeat(64), payer: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe' }),
    reportResourceOutcome: async (value) => { reports.push(value); },
  };
  const fetch = async (request) => {
    calls.push(request);
    if (calls.length === 1) return new Response('', { status: 402, headers: { 'PAYMENT-REQUIRED': encode(required) } });
    assert.equal(request.headers.has('Access-Control-Expose-Headers'), false);
    assert.ok(request.headers.get('PAYMENT-SIGNATURE'));
    return new Response('resource', { status: 402 });
  };
  const response = await ondexX402Fetch('https://merchant.example/report', { method: 'POST', body: 'request body', credentials: 'include', headers: { Authorization: 'caller-owned' } }, { provider, fetch });
  assert.equal(response.status, 402);
  assert.equal(signatures, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers.get('Authorization'), 'caller-owned');
  assert.deepEqual(reports, [{ intentId: 'intent-1', status: 402, hasPaymentResponse: false }]);
}

{
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('stream')); controller.close(); } });
  await assert.rejects(
    () => ondexX402Fetch('https://merchant.example/upload', { method: 'POST', body: stream, duplex: 'half' }, { provider: {}, fetch: async () => new Response() }),
    /x402_request_body_not_replayable/,
  );
}

{
  const required = {
    x402Version: 2,
    resource: { url: 'https://merchant.example/report' },
    accepts: [{ scheme: 'exact', network: 'xrpl:0', amount: '1', asset: 'XRP', payTo: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe', maxTimeoutSeconds: 60, extra: { areFeesSponsored: false } }],
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
  let call = 0;
  let statusChecks = 0;
  const provider = {
    beginInteraction: async () => ({ interactionToken: 'interaction', expiresAt: new Date(Date.now() + 10_000).toISOString() }),
    createPaymentPayload: async () => ({ intentId: 'intent-2', paymentPayload: { x402Version: 2, resource: required.resource, accepted: required.accepts[0], payload: { signedTxBlob: 'ABCD' } } }),
    getIntentStatus: async () => { statusChecks += 1; return { expectedTxHash: 'A'.repeat(64), payer: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe' }; },
    reportResourceOutcome: async () => {},
  };
  const fetch = async () => ++call === 1
    ? new Response('', { status: 402, headers: { 'PAYMENT-REQUIRED': encode(required) } })
    : new Response('resource', { status: 200, headers: { 'PAYMENT-RESPONSE': encode({ success: true, transaction: 'A'.repeat(64), network: 'xrpl:0', payer: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe' }) } });
  assert.equal((await ondexX402Fetch('https://merchant.example/report', {}, { provider, fetch })).status, 200);
  assert.equal(statusChecks, 1);
}

assert.equal(normalizePushServerUrl("http://localhost:3003"), "http://localhost:3003");
assert.equal(normalizePushServerUrl("http://127.0.0.1:3003"), "http://127.0.0.1:3003");
assert.throws(
  () => normalizePushServerUrl("ftp://localhost:3003"),
  /https outside localhost/,
);
assert.throws(
  () => normalizePushServerUrl("http://example.com"),
  /https outside localhost/,
);

{
  const calls = [];
  const response = await createOndexPayload(
    {
      tx_json: { TransactionType: "Payment", Destination: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe", Amount: "1000000" },
      dapp: { name: "Test dApp", url: "https://example.com" },
    },
    {
      pushServerUrl: "http://localhost:3003",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({
          id: "payload-id",
          status: "created",
          expiresAt: "2026-06-17T12:00:00.000Z",
          payload: JSON.parse(init.body),
          links: {
            deeplink: "ondex://payload/payload-id?token=token",
            universal: "https://ondex.money/payload/payload-id?token=token",
            qr: "https://ondex.money/payload/payload-id?token=token",
            status: "/api/v1/payloads/payload-id",
          },
        }), { status: 201 });
      },
    },
  );
  assert.equal(calls[0].url, "http://localhost:3003/api/v1/payloads");
  assert.equal(response.links.status, "/api/v1/payloads/payload-id");
}

await assert.rejects(
  () => createOndexPayload(
    {
      tx_json: { TransactionType: "Payment" },
      requestedAccount: " rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
    },
    { fetch: async () => new Response("{}") },
  ),
  /requestedAccount/,
);

await assert.rejects(
  () => createOndexPayload(
    {
      tx_json: { TransactionType: "Payment" },
      options: { autofill: "yes" },
    },
    { fetch: async () => new Response("{}") },
  ),
  /options.autofill/,
);

{
  const statuses = ["created", "opened", "submitted"];
  const seen = [];
  const final = await pollOndexPayloadStatus("/api/v1/payloads/abc", {
    pushServerUrl: "http://localhost:3003",
    intervalMs: 1,
    timeoutMs: 500,
    onStatus: (status) => seen.push(status.status),
    fetch: async () => {
      const status = statuses.shift();
      return new Response(JSON.stringify({
        id: "abc",
        status,
        expiresAt: "2026-06-17T12:00:00.000Z",
        createdAt: "2026-06-17T11:55:00.000Z",
        openedAt: status === "created" ? null : "2026-06-17T11:56:00.000Z",
        resolvedAt: status === "submitted" ? "2026-06-17T11:57:00.000Z" : null,
        dapp: {},
        tx_json: { TransactionType: "Payment" },
        options: { autofill: true, submit: true },
      }));
    },
  });
  assert.equal(final.status, "submitted");
  assert.deepEqual(seen, ["created", "opened", "submitted"]);
}

await assert.rejects(
  () => pollOndexPayloadStatus("/api/v1/payloads/abc", {
    pushServerUrl: "http://localhost:3003",
    intervalMs: 0,
    fetch: async () => new Response("{}"),
  }),
  /intervalMs/,
);

{
  const request = buildOndexSignInRequest({
    domain: "https://Example.com/login",
    address: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
    nonce: "nonce-123456",
    issuedAt: "2026-06-17T12:00:00.000Z",
    expiresAt: "2026-06-17T12:10:00.000Z",
    statement: "Sign in to the test dApp",
  });

  const result = await verifyOndexSignInResponse(
    {
      ...request,
      signature: "fake-signature",
      publicKey: "fake-public-key",
    },
    {
      deriveAddress: () => request.address,
      verifySignature: ({ messageHex }) => messageHex === request.messageHex,
    },
    { now: new Date("2026-06-17T12:01:00.000Z") },
  );

  assert.deepEqual(result, {
    valid: true,
    address: request.address,
    domain: "example.com",
    nonce: "nonce-123456",
    expiresAt: "2026-06-17T12:10:00.000Z",
  });
}

assert.throws(
  () => buildOndexSignInRequest({
    domain: "example.com",
    address: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
    nonce: "nonce-123456",
    issuedAt: "2026-06-17T12:00:00.000Z",
  }, { lifetimeSeconds: -1 }),
  /invalid_lifetime/,
);

assert.throws(
  () => buildOndexSignInRequest({
    domain: "999.1.1.1",
    address: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
    nonce: "nonce-123456",
  }),
  /invalid_domain/,
);
