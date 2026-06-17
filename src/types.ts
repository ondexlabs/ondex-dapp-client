export const ONDEX_SITE_URL = "https://ondex.money";
export const ONDEX_PUSH_SERVER_URL = "https://push.ondex.money";
export const ONDEX_SIGN_IN_METHOD = "ondex_signIn";

export const ONDEX_XRPL_CHAINS = ["xrpl:0", "xrpl:1", "xrpl:2"] as const;
export type OndexXrplChain = (typeof ONDEX_XRPL_CHAINS)[number];

export const ONDEX_XRPL_METHODS = [
  "xrpl_signTransaction",
  "xrpl_signTransactionFor",
  ONDEX_SIGN_IN_METHOD,
] as const;
export type OndexXrplMethod = (typeof ONDEX_XRPL_METHODS)[number];

export type OndexPayloadStatus =
  | "created"
  | "opened"
  | "rejected"
  | "signed"
  | "submitted"
  | "expired"
  | "failed";

export type OndexPayloadOptions = {
  autofill?: boolean;
  submit?: boolean;
};

export type OndexDappMetadata = {
  name?: string;
  url?: string;
  icon?: string;
};

export type OndexPayloadRequest = {
  tx_json: Record<string, unknown>;
  options?: OndexPayloadOptions;
  requestedAccount?: string;
  returnUrl?: string;
  expiresInSeconds?: number;
  dapp?: OndexDappMetadata;
};

export type OndexPayloadLinks = {
  deeplink: string;
  universal: string;
  qr: string;
  status: string;
};

export type CreateOndexPayloadResponse = {
  id: string;
  status: "created";
  expiresAt: string;
  payload: {
    tx_json: Record<string, unknown>;
    options: Required<OndexPayloadOptions>;
    requestedAccount?: string;
    returnUrl?: string;
    dapp?: OndexDappMetadata;
  };
  links: OndexPayloadLinks;
};

export type OndexPayloadStatusResult = {
  id: string;
  status: OndexPayloadStatus;
  expiresAt: string;
  createdAt: string;
  openedAt: string | null;
  resolvedAt: string | null;
  requestedAccount?: string | null;
  dapp: {
    name?: string | null;
    url?: string | null;
    icon?: string | null;
  };
  tx_json: Record<string, unknown>;
  options: Required<OndexPayloadOptions>;
  returnUrl?: string | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
};

export class OndexDappClientError extends Error {
  readonly status?: number;
  readonly details?: unknown;

  constructor(message: string, options: { status?: number; details?: unknown } = {}) {
    super(message);
    this.name = "OndexDappClientError";
    this.status = options.status;
    this.details = options.details;
  }
}
