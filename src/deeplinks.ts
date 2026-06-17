import { ONDEX_SITE_URL } from "./types.js";

export function normalizeBaseUrl(value: string, fallback = ONDEX_SITE_URL): string {
  const raw = (value || fallback).trim();
  const url = new URL(raw);
  if (url.protocol !== "https:") {
    throw new Error("Ondex public URLs must use https.");
  }
  return url.origin;
}

export function buildOndexPayloadLink(payloadId: string, token: string): string {
  const id = encodeURIComponent(assertBoundedToken(payloadId, "payloadId"));
  const tokenParam = encodeURIComponent(assertBoundedToken(token, "token"));
  return `ondex://payload/${id}?token=${tokenParam}`;
}

export function buildOndexUniversalPayloadLink(
  payloadId: string,
  token: string,
  options: { siteUrl?: string } = {},
): string {
  const origin = normalizeBaseUrl(options.siteUrl ?? ONDEX_SITE_URL);
  const id = encodeURIComponent(assertBoundedToken(payloadId, "payloadId"));
  const tokenParam = encodeURIComponent(assertBoundedToken(token, "token"));
  return `${origin}/payload/${id}?token=${tokenParam}`;
}

function assertBoundedToken(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256 || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw new Error(`Invalid ${label}.`);
  }
  return trimmed;
}
