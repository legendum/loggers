import legendum from "../auth/legendum.js";
import { issueFromError } from "./charge";
import { getTabSpec } from "./config";
import type {
  BillingResult,
  BillingTab,
  BillingTabs,
  TabChannel,
} from "./types";

type SubjectKey = string;

function toSubjectKey(subject: string | number): SubjectKey {
  return String(subject);
}

export function createTab(args: {
  subject: string | number;
  accountToken: string | null;
  description: string;
  threshold: number;
  defaultAmount?: number;
  onTokenInvalid?: (subject: string | number) => void | Promise<void>;
}): BillingTab {
  let tab: {
    add(amount?: number): Promise<void>;
    flush(): Promise<void>;
    close(): Promise<void>;
  } | null = null;

  function ensureTab() {
    if (!args.accountToken || tab) return;
    tab = legendum.tab(args.accountToken, args.description, {
      threshold: args.threshold,
      ...(typeof args.defaultAmount === "number"
        ? { amount: args.defaultAmount }
        : {}),
    });
  }

  async function onTokenInvalid() {
    if (args.onTokenInvalid) {
      await args.onTokenInvalid(args.subject);
    }
  }

  return {
    add: async (amount?: number): Promise<BillingResult<null>> => {
      if (!args.accountToken) return { ok: true, value: null };
      ensureTab();
      try {
        await tab!.add(amount);
        return { ok: true, value: null };
      } catch (err) {
        const issue = issueFromError(err);
        if (issue.code === "token_not_found") {
          tab = null;
          await onTokenInvalid();
        }
        return { ok: false, issue };
      }
    },
    flush: async () => {
      if (!tab) return;
      try {
        await tab.flush();
      } catch {
        // best-effort flush
      }
    },
    close: async () => {
      if (!tab) return;
      const current = tab;
      tab = null;
      try {
        await current.close();
      } catch {
        // best-effort close
      }
    },
  };
}

export function createTabFromConfig(args: {
  subject: string | number;
  accountToken: string | null;
  name: string;
  root?: string;
  onTokenInvalid?: (subject: string | number) => void | Promise<void>;
}): BillingTab {
  const spec = getTabSpec(args.name, args.root);
  return createTab({
    subject: args.subject,
    accountToken: args.accountToken,
    description: spec.description,
    threshold: spec.threshold,
    defaultAmount: spec.default_amount,
    onTokenInvalid: args.onTokenInvalid,
  });
}

export function createTabs(args: {
  channels: Record<string, TabChannel>;
  onTokenInvalid?: (subject: string | number) => void | Promise<void>;
}): BillingTabs {
  const bySubject = new Map<SubjectKey, Map<string, BillingTab>>();

  function getChannel(name: string): TabChannel {
    const channel = args.channels[name];
    if (!channel) {
      throw new Error(`[pues/billing] unknown tab channel: ${name}`);
    }
    return channel;
  }

  function getOrCreateTab(params: {
    channel: string;
    subject: string | number;
    accountToken: string | null;
  }): BillingTab {
    const key = toSubjectKey(params.subject);
    const subjectTabs = bySubject.get(key) ?? new Map<string, BillingTab>();
    if (!bySubject.has(key)) bySubject.set(key, subjectTabs);
    const existing = subjectTabs.get(params.channel);
    if (existing) return existing;

    const c = getChannel(params.channel);
    const created = createTab({
      subject: params.subject,
      accountToken: params.accountToken,
      description: c.description,
      threshold: c.threshold,
      defaultAmount: c.defaultAmount,
      onTokenInvalid: args.onTokenInvalid,
    });
    subjectTabs.set(params.channel, created);
    return created;
  }

  async function forEachSelected(
    selected: { subject?: string | number; channel?: string } | undefined,
    fn: (tab: BillingTab, key: SubjectKey, channel: string) => Promise<void>,
  ): Promise<void> {
    const subjects = selected?.subject
      ? [toSubjectKey(selected.subject)]
      : [...bySubject.keys()];
    for (const key of subjects) {
      const subjectTabs = bySubject.get(key);
      if (!subjectTabs) continue;
      const channels = selected?.channel
        ? [selected.channel]
        : [...subjectTabs.keys()];
      for (const channel of channels) {
        const tab = subjectTabs.get(channel);
        if (!tab) continue;
        await fn(tab, key, channel);
      }
    }
  }

  return {
    add: async ({ channel, subject, accountToken, amount }) => {
      const tab = getOrCreateTab({ channel, subject, accountToken });
      return tab.add(amount);
    },
    flush: async (selected) => {
      await forEachSelected(selected, async (tab) => {
        await tab.flush();
      });
    },
    close: async (selected) => {
      await forEachSelected(selected, async (tab, key, channel) => {
        await tab.close();
        const subjectTabs = bySubject.get(key);
        if (!subjectTabs) return;
        subjectTabs.delete(channel);
        if (subjectTabs.size === 0) bySubject.delete(key);
      });
    },
    closeAll: async () => {
      for (const [key, subjectTabs] of bySubject) {
        for (const [channel, tab] of subjectTabs) {
          await tab.close();
          subjectTabs.delete(channel);
        }
        bySubject.delete(key);
      }
    },
  };
}
