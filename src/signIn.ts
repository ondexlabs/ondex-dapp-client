import { ONDEX_SIGN_IN_METHOD } from "./types.js";

export type OndexSignInRequest = {
  domain: string;
  address: string;
  nonce: string;
  issuedAt?: string;
  expiresAt?: string;
  statement?: string;
};

export type NormalizedOndexSignInRequest = Required<
  Pick<OndexSignInRequest, "domain" | "address" | "nonce" | "issuedAt">
> & {
  method: typeof ONDEX_SIGN_IN_METHOD;
  expiresAt?: string;
  statement?: string;
  message: string;
  messageHex: string;
};

export type OndexSignInResponse = NormalizedOndexSignInRequest & {
  signature: string;
  publicKey: string;
  signingAlgorithm?: "ed25519" | "secp256k1";
};

export type OndexSignInVerifier = {
  deriveAddress(publicKey: string): string | Promise<string>;
  verifySignature(args: {
    messageHex: string;
    signature: string;
    publicKey: string;
  }): boolean | Promise<boolean>;
};

export type VerifyOndexSignInResult =
  | { valid: true; address: string; domain: string; nonce: string; expiresAt?: string }
  | { valid: false; reason: string };

const MAX_STATEMENT_LENGTH = 500;
const NONCE_RE = /^[A-Za-z0-9._~:-]{8,256}$/;
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

export function buildOndexSignInRequest(
  params: OndexSignInRequest,
  options: { lifetimeSeconds?: number; now?: Date } = {},
): NormalizedOndexSignInRequest {
  const issuedAt = parseIsoDate(params.issuedAt ?? (options.now ?? new Date()).toISOString());
  const expiresAt = params.expiresAt
    ? parseIsoDate(params.expiresAt)
    : new Date(Date.parse(issuedAt) + (options.lifetimeSeconds ?? 10 * 60) * 1000).toISOString();

  const request = {
    method: ONDEX_SIGN_IN_METHOD,
    domain: normalizeDomain(params.domain),
    address: normalizeAddress(params.address),
    nonce: normalizeNonce(params.nonce),
    issuedAt,
    expiresAt,
    statement: normalizeOptionalStatement(params.statement),
  } satisfies Omit<NormalizedOndexSignInRequest, "message" | "messageHex">;
  const message = buildOndexSignInMessage(request);

  return {
    ...request,
    message,
    messageHex: messageToHex(message),
  };
}

export function buildOndexSignInMessage(
  request: Pick<NormalizedOndexSignInRequest, "domain" | "address" | "nonce" | "issuedAt" | "expiresAt" | "statement">,
): string {
  return [
    "Ondex Sign-In",
    "",
    `Domain: ${request.domain}`,
    `Address: ${request.address}`,
    `Nonce: ${request.nonce}`,
    `Issued At: ${request.issuedAt}`,
    ...(request.expiresAt ? [`Expires At: ${request.expiresAt}`] : []),
    ...(request.statement ? [`Statement: ${request.statement}`] : []),
  ].join("\n");
}

export function messageToHex(message: string): string {
  return Array.from(new TextEncoder().encode(message))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export async function verifyOndexSignInResponse(
  response: OndexSignInResponse,
  verifier: OndexSignInVerifier,
  options: { now?: Date; allowExpired?: boolean } = {},
): Promise<VerifyOndexSignInResult> {
  try {
    const normalized = buildOndexSignInRequest({
      domain: response.domain,
      address: response.address,
      nonce: response.nonce,
      issuedAt: response.issuedAt,
      expiresAt: response.expiresAt,
      statement: response.statement,
    });

    if (response.method !== ONDEX_SIGN_IN_METHOD) return { valid: false, reason: "unsupported_method" };
    if (response.message !== normalized.message) return { valid: false, reason: "message_mismatch" };
    if (response.messageHex !== normalized.messageHex) return { valid: false, reason: "message_hex_mismatch" };
    if (!options.allowExpired && response.expiresAt && Date.parse(response.expiresAt) <= (options.now ?? new Date()).getTime()) {
      return { valid: false, reason: "expired" };
    }

    const derivedAddress = await verifier.deriveAddress(response.publicKey);
    if (derivedAddress !== response.address) return { valid: false, reason: "public_key_address_mismatch" };

    const signatureValid = await verifier.verifySignature({
      messageHex: response.messageHex,
      signature: response.signature,
      publicKey: response.publicKey,
    });
    if (!signatureValid) return { valid: false, reason: "invalid_signature" };

    return {
      valid: true,
      address: response.address,
      domain: normalized.domain,
      nonce: normalized.nonce,
      expiresAt: normalized.expiresAt,
    };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : "invalid_response",
    };
  }
}

function normalizeDomain(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error("invalid_domain");

  let hostname = raw;
  if (raw.includes("://")) {
    hostname = new URL(raw).hostname;
  } else if (raw.includes("/") || raw.includes("?") || raw.includes("#")) {
    throw new Error("invalid_domain");
  }

  hostname = hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
  if (hostname.length > 253 || !hostname.includes(".")) throw new Error("invalid_domain");
  if (!hostname.split(".").every((label) => (
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ))) {
    throw new Error("invalid_domain");
  }
  return hostname;
}

function normalizeAddress(value: string): string {
  const address = value.trim();
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address)) throw new Error("invalid_address");
  return address;
}

function normalizeNonce(value: string): string {
  const nonce = value.trim();
  if (!NONCE_RE.test(nonce)) throw new Error("invalid_nonce");
  return nonce;
}

function parseIsoDate(value: string): string {
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) throw new Error("invalid_date");
  return new Date(parsedMs).toISOString();
}

function normalizeOptionalStatement(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  const statement = value.trim();
  if (!statement) return undefined;
  if (statement.length > MAX_STATEMENT_LENGTH || CONTROL_CHAR_RE.test(statement)) {
    throw new Error("invalid_statement");
  }
  return statement;
}
