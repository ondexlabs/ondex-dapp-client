import { normalizeBaseUrl } from "./deeplinks.js";
import { ONDEX_SITE_URL } from "./types.js";

export type OndexWalletConnectLinkOptions = {
  siteUrl?: string;
  universalPath?: "/wc" | "/connect";
};

export function buildOndexWalletConnectLink(wcUri: string): string {
  return `ondex://wc?uri=${encodeURIComponent(normalizeWalletConnectUri(wcUri))}`;
}

export function buildOndexUniversalConnectLink(
  wcUri: string,
  options: OndexWalletConnectLinkOptions = {},
): string {
  const origin = normalizeBaseUrl(options.siteUrl ?? ONDEX_SITE_URL);
  const path = options.universalPath ?? "/wc";
  return `${origin}${path}?uri=${encodeURIComponent(normalizeWalletConnectUri(wcUri))}`;
}

export function normalizeWalletConnectUri(wcUri: string): string {
  const raw = wcUri.trim();
  if (!raw || raw.length > 4096 || /[\u0000-\u001F\u007F]/.test(raw)) {
    throw new Error("Invalid WalletConnect URI.");
  }

  const normalized = raw.startsWith("wc://") ? `wc:${raw.slice("wc://".length)}` : raw;
  if (!normalized.startsWith("wc:") || !normalized.includes("@2")) {
    throw new Error("Ondex requires a WalletConnect v2 URI.");
  }

  return normalized;
}
