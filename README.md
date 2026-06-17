# @ondex/dapp-client

Public TypeScript helpers for XRPL dApps that want to connect to Ondex through WalletConnect, mobile links, one-shot payloads, or `ondex_signIn`.

Ondex is self-custodial. This package never handles wallet seeds or private keys, and it does not expose Ondex-owned WalletConnect credentials. dApps should use their own Reown/AppKit project configuration.

## Install

```bash
pnpm add @ondex/dapp-client
```

## WalletConnect links

```ts
import {
  buildOndexUniversalConnectLink,
  buildOndexWalletConnectLink,
} from "@ondex/dapp-client";

const wcUri = "wc:<topic>@2?relay-protocol=irn&symKey=<key>";

const mobile = buildOndexWalletConnectLink(wcUri);
const universal = buildOndexUniversalConnectLink(wcUri);
```

Render the raw `wc:` URI in desktop QR flows. Use the native or universal link for mobile wallet picker buttons.

## One-shot payloads

```ts
import {
  createOndexPayload,
  pollOndexPayloadStatus,
} from "@ondex/dapp-client";

const created = await createOndexPayload({
  tx_json: {
    TransactionType: "Payment",
    Destination: "r...",
    Amount: "1000000",
  },
  options: { autofill: true, submit: true },
  dapp: { name: "Example dApp", url: "https://example.com" },
});

console.log(created.links.qr);
console.log(created.links.universal);

const final = await pollOndexPayloadStatus(created.links.status);
```

The payload API returns a relative `links.status` path. The SDK resolves it against `https://push.ondex.money` by default. Pass `pushServerUrl` for local development.

## Sign-in verification

Ondex signs this canonical message for `ondex_signIn`:

```text
Ondex Sign-In

Domain: example.com
Address: r...
Nonce: nonce-123456
Issued At: 2026-06-17T12:00:00.000Z
Expires At: 2026-06-17T12:10:00.000Z
Statement: Sign in to Example
```

The SDK rebuilds and checks the canonical message. Your app provides XRPL keypair verification so you can choose the runtime dependency you already trust.

```ts
import { deriveAddress, verify } from "ripple-keypairs";
import { verifyOndexSignInResponse } from "@ondex/dapp-client";

const result = await verifyOndexSignInResponse(response, {
  deriveAddress,
  verifySignature: ({ messageHex, signature, publicKey }) =>
    verify(messageHex, signature, publicKey),
});

if (!result.valid) throw new Error(result.reason);
```

Always verify the returned public key derives to the returned XRPL address, then bind the session to your own nonce and expiry.

## Supported XRPL contract

- Namespace: `xrpl`
- Mainnet: `xrpl:0`
- Testnet: `xrpl:1`
- Devnet proposal compatibility: `xrpl:2`
- Methods: `xrpl_signTransaction`, `xrpl_signTransactionFor`, `ondex_signIn`

Batch signing is intentionally not exposed. Payment-critical apps must verify final ledger state after submission.
