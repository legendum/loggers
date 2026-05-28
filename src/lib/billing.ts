import {
  type BillingTab,
  chargeNamed,
  createTabFromConfig,
  isInsufficientFunds,
  isTokenInvalid,
} from "pues/base/billing/server";
import { isSelfHosted } from "pues/base/core";
import { getDb } from "pues/base/db/server";

const ingestTabs = new Map<string, BillingTab>();

function getUserToken(userId: number): string | null {
  const row = getDb()
    .query("SELECT legendum_token FROM users WHERE id = ?")
    .get(userId) as { legendum_token: string | null } | undefined;
  return row?.legendum_token ?? null;
}

function jsonError(status: number, error: string, message: string): Response {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clearToken(userId: number): void {
  getDb().run("UPDATE users SET legendum_token = NULL WHERE id = ?", [userId]);
}

function getIngestTab(token: string): BillingTab {
  const cached = ingestTabs.get(token);
  if (cached) return cached;
  const created = createTabFromConfig({
    subject: token,
    accountToken: token,
    name: "ingest_write",
  });
  ingestTabs.set(token, created);
  return created;
}

function paymentRequired(message: string): Response {
  return jsonError(402, "payment_required", message);
}

export async function chargeLoggerCreate(
  userId: number,
): Promise<Response | null> {
  if (isSelfHosted()) return null;
  const token = getUserToken(userId);
  if (!token) {
    return paymentRequired("Link a Legendum account to create loggers");
  }

  const result = await chargeNamed({
    accountToken: token,
    name: "logger_create",
  });
  if (result.ok) return null;

  if (isInsufficientFunds(result)) {
    return jsonError(402, "insufficient_funds", "Not enough Legendum credits");
  }
  if (isTokenInvalid(result)) {
    clearToken(userId);
    return paymentRequired("Legendum account disconnected. Please re-link.");
  }
  console.error("logger_create charge failed", result.issue);
  return jsonError(429, "charge_failed", "Billing failed");
}

export async function chargeIngestWrite(
  userId: number,
  acceptedCount = 1,
): Promise<Response | null> {
  if (acceptedCount <= 0 || isSelfHosted()) return null;
  const token = getUserToken(userId);
  if (!token) {
    return paymentRequired("Link a Legendum account to ingest logs");
  }

  const tab = getIngestTab(token);
  for (let i = 0; i < acceptedCount; i++) {
    const result = await tab.add();
    if (result.ok) continue;

    if (isInsufficientFunds(result)) {
      return jsonError(
        402,
        "insufficient_funds",
        "Not enough Legendum credits",
      );
    }
    if (isTokenInvalid(result)) {
      clearToken(userId);
      ingestTabs.delete(token);
      return paymentRequired("Legendum account disconnected. Please re-link.");
    }
    console.error("ingest_write tab add failed", result.issue);
    return jsonError(429, "charge_failed", "Billing failed");
  }
  return null;
}

export async function closeBillingTabs(): Promise<void> {
  for (const [_token, tab] of ingestTabs) {
    try {
      await tab.close();
    } catch {
      // best-effort shutdown close
    }
  }
  ingestTabs.clear();
}
