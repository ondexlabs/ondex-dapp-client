export type X402PaymentRequired = {
  x402Version: 2;
  error?: string;
  resource: { url: string; description?: string; mimeType?: string; serviceName?: string; tags?: string[]; iconUrl?: string };
  accepts: Array<Record<string, unknown>>;
  extensions?: Record<string, unknown>;
};

export type X402PaymentPayload = {
  x402Version: 2;
  resource?: X402PaymentRequired['resource'];
  accepted: Record<string, unknown>;
  payload: { signedTxBlob: string; invoiceId?: string };
  extensions?: Record<string, unknown>;
};

export type OndexX402IntentStatus = { expectedTxHash?: string | null; payer?: string | null; walletAddress?: string | null; [key: string]: unknown };

export type OndexX402Provider = {
  getCapabilities(): Promise<Record<string, unknown>>;
  beginInteraction(): Promise<{ interactionToken: string; expiresAt: string }>;
  createPaymentPayload(input: { paymentRequired: unknown; interactionToken: string; operationId: string }): Promise<{ intentId: string; paymentPayload: X402PaymentPayload }>;
  getIntentStatus(input: { intentId: string }): Promise<OndexX402IntentStatus>;
  reportResourceOutcome(input: { intentId: string; status: number | 'network_error' | 'cors_error'; hasPaymentResponse: boolean; paymentResponseValid?: boolean }): Promise<void>;
};

export type OndexX402FetchOptions = {
  fetch?: typeof globalThis.fetch;
  provider?: OndexX402Provider;
  maxRedirects?: number;
};

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_HEADER_LENGTH = 32 * 1024;
const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function assertSafeTree(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error('x402_header_too_deep');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (POLLUTION_KEYS.has(key)) throw new Error('x402_header_unsafe_key');
    assertSafeTree(child, depth + 1);
  }
}

function decodeHeader(value: string): unknown {
  if (!value || value.length > MAX_HEADER_LENGTH || !BASE64_RE.test(value) || /[-_]/.test(value)) throw new Error('invalid_x402_header');
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  if (bytes.byteLength > 24 * 1024) throw new Error('x402_header_too_large');
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  assertSafeTree(parsed);
  return parsed;
}

function encodeHeader(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.byteLength > 24 * 1024) throw new Error('x402_header_too_large');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function singleHeader(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  if (value?.includes(',')) throw new Error(`duplicate_${name.toLowerCase()}_header`);
  return value;
}

function providerFromWindow(): OndexX402Provider {
  const provider = (globalThis as typeof globalThis & { window?: { ondex?: { x402?: OndexX402Provider } } }).window?.ondex?.x402;
  if (!provider) throw new Error('ondex_x402_provider_unavailable');
  return provider;
}

function validatePaymentRequired(value: unknown): X402PaymentRequired {
  if (!value || typeof value !== 'object' || (value as { x402Version?: unknown }).x402Version !== 2 || !Array.isArray((value as { accepts?: unknown }).accepts)) throw new Error('invalid_payment_required');
  return value as X402PaymentRequired;
}

function validateSettlementResponse(value: unknown, expectedNetwork: unknown, expectedHash?: string | null, expectedPayer?: string | null): void {
  if (!value || typeof value !== 'object') throw new Error('invalid_payment_response');
  const response = value as Record<string, unknown>;
  const allowed = new Set(['success', 'errorReason', 'errorMessage', 'payer', 'transaction', 'network', 'amount', 'extensions', 'extra']);
  if (Object.keys(response).some((key) => !allowed.has(key))) throw new Error('invalid_payment_response');
  if (typeof response.success !== 'boolean' || typeof response.transaction !== 'string' || !/^[0-9A-Fa-f]{64}$/.test(response.transaction) || !['xrpl:0', 'xrpl:1'].includes(String(response.network))) throw new Error('invalid_payment_response');
  for (const key of ['errorReason', 'errorMessage', 'payer', 'amount']) if (response[key] !== undefined && typeof response[key] !== 'string') throw new Error('invalid_payment_response');
  for (const key of ['extensions', 'extra']) if (response[key] !== undefined && (!response[key] || typeof response[key] !== 'object' || Array.isArray(response[key]))) throw new Error('invalid_payment_response');
  if (expectedNetwork && response.network !== expectedNetwork) throw new Error('payment_response_network_mismatch');
  if (expectedHash && response.transaction.toUpperCase() !== expectedHash.replace(/^0x/i, '').toUpperCase()) throw new Error('payment_response_transaction_mismatch');
  if (response.payer && expectedPayer && response.payer !== expectedPayer) throw new Error('payment_response_payer_mismatch');
}

async function fetchPaid(request: Request, fetchImpl: typeof globalThis.fetch, maxRedirects: number): Promise<Response> {
  let current = request;
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetchImpl(current);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirects >= maxRedirects) throw new Error('x402_redirect_limit');
    const location = response.headers.get('location');
    if (!location) return response;
    const next = new URL(location, current.url);
    if (next.origin !== new URL(current.url).origin) throw new Error('x402_cross_origin_redirect');
    if (current.method !== 'GET' && response.status !== 303) throw new Error('x402_non_replayable_redirect');
    current = new Request(next, { method: 'GET', headers: current.headers, credentials: current.credentials, redirect: 'manual' });
  }
}

export async function ondexX402Fetch(input: RequestInfo | URL, init: RequestInit = {}, options: OndexX402FetchOptions = {}): Promise<Response> {
  const provider = options.provider ?? providerFromWindow();
  if (input instanceof Request && input.body) throw new Error('x402_request_body_not_replayable');
  if (typeof ReadableStream !== 'undefined' && init.body instanceof ReadableStream) throw new Error('x402_request_body_not_replayable');
  const request = new Request(input, init);
  if (['HEAD', 'OPTIONS'].includes(request.method)) throw new Error('x402_method_not_payable');
  if ((globalThis as typeof globalThis & { document?: { prerendering?: boolean } }).document?.prerendering) throw new Error('x402_prerender_blocked');
  let retryTemplate: Request;
  try { retryTemplate = request.clone(); } catch { throw new Error('x402_request_body_not_replayable'); }
  const operationId = crypto.randomUUID();
  const interactionPromise = provider.beginInteraction();
  const interaction = await interactionPromise;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const first = await fetchImpl(request);
  if (first.status !== 402) return first;
  const paymentRequiredHeader = singleHeader(first.headers, 'PAYMENT-REQUIRED');
  if (!paymentRequiredHeader) return first;
  const paymentRequired = validatePaymentRequired(decodeHeader(paymentRequiredHeader));
  if (first.url && first.url !== retryTemplate.url) throw new Error('x402_redirect_before_payment');
  const created = await provider.createPaymentPayload({ paymentRequired, interactionToken: interaction.interactionToken, operationId });
  const headers = new Headers(retryTemplate.headers);
  headers.set('PAYMENT-SIGNATURE', encodeHeader(created.paymentPayload));
  headers.delete('Access-Control-Expose-Headers');
  const paidRequest = new Request(retryTemplate, { headers, redirect: 'manual' });
  let paid: Response;
  try {
    paid = await fetchPaid(paidRequest, fetchImpl, Math.max(0, Math.min(options.maxRedirects ?? 3, 5)));
  } catch (error) {
    await provider.reportResourceOutcome({ intentId: created.intentId, status: 'network_error', hasPaymentResponse: false }).catch(() => undefined);
    throw error;
  }
  const paymentResponseHeader = singleHeader(paid.headers, 'PAYMENT-RESPONSE');
  const status: OndexX402IntentStatus = await provider.getIntentStatus({ intentId: created.intentId }).catch(() => ({}));
  if (paymentResponseHeader) {
    try {
      validateSettlementResponse(decodeHeader(paymentResponseHeader), created.paymentPayload.accepted.network, status.expectedTxHash, status.payer ?? status.walletAddress);
    } catch (error) {
      await provider.reportResourceOutcome({ intentId: created.intentId, status: paid.status, hasPaymentResponse: true, paymentResponseValid: false }).catch(() => undefined);
      throw error;
    }
  }
  await provider.reportResourceOutcome({ intentId: created.intentId, status: paid.status, hasPaymentResponse: Boolean(paymentResponseHeader), ...(paymentResponseHeader ? { paymentResponseValid: true } : {}) }).catch(() => undefined);
  return paid;
}
