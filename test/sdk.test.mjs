import assert from "node:assert/strict";
import {
  buildOndexSignInRequest,
  buildOndexUniversalConnectLink,
  buildOndexWalletConnectLink,
  createOndexPayload,
  pollOndexPayloadStatus,
  resolveOndexPayloadStatusUrl,
  verifyOndexSignInResponse,
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
