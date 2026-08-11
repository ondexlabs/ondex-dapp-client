import {
  ONDEX_PUSH_SERVER_URL,
  type CreateOndexPayloadResponse,
  type OndexPayloadRequest,
  type OndexPayloadStatus,
  type OndexPayloadStatusResult,
  OndexDappClientError,
} from "./types.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type OndexPayloadClientOptions = {
  pushServerUrl?: string;
  fetch?: FetchLike;
  signal?: AbortSignal;
};

export type PollOndexPayloadStatusOptions = OndexPayloadClientOptions & {
  intervalMs?: number;
  timeoutMs?: number;
  terminalStatuses?: readonly OndexPayloadStatus[];
  onStatus?: (status: OndexPayloadStatusResult) => void;
};

const TERMINAL_PAYLOAD_STATUSES = ["rejected", "signed", "submitted", "expired", "failed"] as const;
const ALL_PAYLOAD_STATUSES = ["created", "opened", ...TERMINAL_PAYLOAD_STATUSES] as const;
const MAX_TX_JSON_BYTES = 16 * 1024;
const MAX_DAPP_NAME_LENGTH = 120;
const MAX_EXPIRES_IN_SECONDS = 24 * 60 * 60;
const CLASSIC_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

export async function createOndexPayload(
  request: OndexPayloadRequest,
  options: OndexPayloadClientOptions = {},
): Promise<CreateOndexPayloadResponse> {
  assertPayloadRequest(request);
  const fetchImpl = resolveFetch(options.fetch);
  const endpoint = new URL("/api/v1/payloads", normalizePushServerUrl(options.pushServerUrl));

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: options.signal,
  });
  const body = await readJson(response);

  if (!response.ok) {
    throw new OndexDappClientError("Ondex payload creation failed.", {
      status: response.status,
      details: body,
    });
  }

  return body as CreateOndexPayloadResponse;
}

export async function getOndexPayloadStatus(
  statusUrl: string,
  options: OndexPayloadClientOptions = {},
): Promise<OndexPayloadStatusResult> {
  const fetchImpl = resolveFetch(options.fetch);
  const endpoint = resolveOndexPayloadStatusUrl(statusUrl, options.pushServerUrl);
  const response = await fetchImpl(endpoint, { method: "GET", signal: options.signal });
  const body = await readJson(response);

  if (!response.ok) {
    throw new OndexDappClientError("Ondex payload status request failed.", {
      status: response.status,
      details: body,
    });
  }

  return body as OndexPayloadStatusResult;
}

export async function pollOndexPayloadStatus(
  statusUrl: string,
  options: PollOndexPayloadStatusOptions = {},
): Promise<OndexPayloadStatusResult> {
  const intervalMs = options.intervalMs ?? 1500;
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const terminalStatuses = options.terminalStatuses ?? TERMINAL_PAYLOAD_STATUSES;
  assertPositiveFinite(intervalMs, "intervalMs");
  assertPositiveFinite(timeoutMs, "timeoutMs");
  assertTerminalStatuses(terminalStatuses);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const status = await getOndexPayloadStatus(statusUrl, options);
    options.onStatus?.(status);
    if (terminalStatuses.includes(status.status)) return status;
    if (Date.now() >= deadline) {
      throw new OndexDappClientError("Timed out while polling Ondex payload status.", {
        details: { statusUrl, lastStatus: status.status },
      });
    }
    await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())), options.signal);
  }
}

export function resolveOndexPayloadStatusUrl(
  statusUrl: string,
  pushServerUrl = ONDEX_PUSH_SERVER_URL,
): string {
  const base = normalizePushServerUrl(pushServerUrl);
  const endpoint = new URL(statusUrl, base);
  if (endpoint.origin !== base) {
    throw new Error("Ondex payload status URLs must use the configured push server origin.");
  }
  return endpoint.toString();
}

export function normalizePushServerUrl(value = ONDEX_PUSH_SERVER_URL): string {
  const url = new URL(value);
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol === "https:" || (url.protocol === "http:" && isLoopback)) {
    return url.origin;
  }
  throw new Error("Ondex push server URLs must use https outside localhost.");
}

function assertPayloadRequest(request: OndexPayloadRequest): void {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Payload request must be an object.");
  }
  if (!isRecord(request.tx_json) || typeof request.tx_json.TransactionType !== "string") {
    throw new Error("Payload tx_json.TransactionType is required.");
  }
  if (byteLength(JSON.stringify(request.tx_json)) > MAX_TX_JSON_BYTES) {
    throw new Error("Payload tx_json is too large.");
  }
  if (request.options !== undefined) {
    if (!isRecord(request.options)) throw new Error("Payload options must be an object.");
    assertOptionalBoolean(request.options.autofill, "options.autofill");
    assertOptionalBoolean(request.options.submit, "options.submit");
  }
  if (request.requestedAccount !== undefined) {
    assertClassicAddress(request.requestedAccount, "requestedAccount");
  }
  if (request.expiresInSeconds !== undefined) {
    if (
      !Number.isInteger(request.expiresInSeconds) ||
      request.expiresInSeconds <= 0 ||
      request.expiresInSeconds > MAX_EXPIRES_IN_SECONDS
    ) {
      throw new Error("Payload expiresInSeconds must be between 1 and 86400.");
    }
  }
  if (request.dapp?.name !== undefined) {
    assertBoundedText(request.dapp.name, "dapp.name", MAX_DAPP_NAME_LENGTH);
  }
  for (const value of [request.returnUrl, request.dapp?.url, request.dapp?.icon]) {
    if (value !== undefined) assertHttpsUrl(value);
  }
}

function assertOptionalBoolean(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`Payload ${label} must be boolean.`);
  }
}

function assertClassicAddress(value: string, label: string): void {
  if (value.trim() !== value || !CLASSIC_ADDRESS_RE.test(value)) {
    throw new Error(`Payload ${label} must be a classic XRPL address.`);
  }
}

function assertBoundedText(value: string, label: string, maxLength: number): void {
  if (typeof value !== "string" || value.trim() !== value || !value || value.length > maxLength || CONTROL_CHAR_RE.test(value)) {
    throw new Error(`Payload ${label} is invalid.`);
  }
}

function assertHttpsUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Payload URLs must use https.");
}

function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  const candidate = fetchImpl ?? globalThis.fetch;
  if (!candidate) throw new Error("A fetch implementation is required.");
  return candidate.bind(globalThis) as FetchLike;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

function assertTerminalStatuses(statuses: readonly OndexPayloadStatus[]): void {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    throw new Error("terminalStatuses must contain at least one status.");
  }
  const allowed = new Set<string>(ALL_PAYLOAD_STATUSES);
  if (!statuses.every((status) => allowed.has(status))) {
    throw new Error("terminalStatuses contains an unknown payload status.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
