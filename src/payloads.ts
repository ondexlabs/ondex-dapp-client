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
const MAX_TX_JSON_BYTES = 16 * 1024;

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
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Ondex push server URLs must use https outside localhost.");
  }
  return url.origin;
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
  for (const value of [request.returnUrl, request.dapp?.url, request.dapp?.icon]) {
    if (value !== undefined) assertHttpsUrl(value);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
