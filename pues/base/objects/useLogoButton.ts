import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { puesAppMeta } from "../core/puesAppMeta.generated";

const DEFAULT_WIGGLE_INTERVAL_MS = 60_000;
const DEFAULT_SEEN_COOKIE_DAYS = 365;
const WIGGLE_DURATION_MS = 1500;
const WIGGLE_EASING = "ease-in-out";
const WIGGLE_KEYFRAMES: Keyframe[] = [
  { transform: "rotate(0deg)" },
  { offset: 0.25, transform: "rotate(-8deg)" },
  { offset: 0.75, transform: "rotate(8deg)" },
  { transform: "rotate(0deg)" },
];

function normalizeCookieToken(raw: string): string {
  const token = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token || "app";
}

function getDefaultLogoSeenCookieName(appName: string): string {
  return `pues.logo-seen.${normalizeCookieToken(appName || "app")}`;
}

function readSeenCookie(name: string): boolean {
  if (typeof document === "undefined") return false;
  const needle = `${encodeURIComponent(name)}=`;
  return document.cookie
    .split(";")
    .some((part) => part.trim().startsWith(needle));
}

function writeSeenCookie(name: string, days: number): void {
  if (typeof document === "undefined") return;
  const maxAge = Math.max(1, Math.floor(days * 24 * 60 * 60));
  // biome-ignore lint/suspicious/noDocumentCookie: Client-side persistence for one-time logo nudges uses browser cookies intentionally.
  document.cookie =
    `${encodeURIComponent(name)}=1; ` +
    `Max-Age=${maxAge}; Path=/; SameSite=Lax`;
}

function reduceMotionPreferred(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type UseLogoButtonOptions = {
  wiggleIntervalMs?: number;
  seenCookieName?: string;
  seenCookieDays?: number;
  onClick?: () => void;
};

export type UseLogoButtonResult = {
  imageRef: RefObject<HTMLImageElement>;
  hasSeenLogo: boolean;
  triggerWiggle: () => void;
  handleClick: () => void;
};

/**
 * Shared behavior for top-left logo affordances.
 *
 * Behavior:
 * - auto-wiggle every `wiggleIntervalMs` until first click
 * - persist "seen" via cookie on first click
 * - always wiggle on hover
 * - run optional `onClick` callback on click
 */
export function useLogoButton({
  wiggleIntervalMs = DEFAULT_WIGGLE_INTERVAL_MS,
  seenCookieName,
  seenCookieDays = DEFAULT_SEEN_COOKIE_DAYS,
  onClick,
}: UseLogoButtonOptions = {}): UseLogoButtonResult {
  const imageRef = useRef<HTMLImageElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const resolvedCookieName =
    seenCookieName ?? getDefaultLogoSeenCookieName(puesAppMeta.name);
  const resolvedWiggleIntervalMs = Math.max(1000, wiggleIntervalMs);
  const [hasSeenLogo, setHasSeenLogo] = useState<boolean>(() =>
    readSeenCookie(resolvedCookieName),
  );

  useEffect(() => {
    setHasSeenLogo(readSeenCookie(resolvedCookieName));
  }, [resolvedCookieName]);

  const triggerWiggle = useCallback(() => {
    if (reduceMotionPreferred()) return;
    const el = imageRef.current;
    if (!el) return;
    animationRef.current?.cancel();
    animationRef.current = el.animate(WIGGLE_KEYFRAMES, {
      duration: WIGGLE_DURATION_MS,
      easing: WIGGLE_EASING,
      iterations: 1,
    });
  }, []);

  useEffect(() => {
    if (hasSeenLogo || typeof window === "undefined") return;
    const intervalId = window.setInterval(
      triggerWiggle,
      resolvedWiggleIntervalMs,
    );
    return () => window.clearInterval(intervalId);
  }, [hasSeenLogo, resolvedWiggleIntervalMs, triggerWiggle]);

  useEffect(
    () => () => {
      animationRef.current?.cancel();
      animationRef.current = null;
    },
    [],
  );

  const handleClick = () => {
    if (!hasSeenLogo) {
      writeSeenCookie(resolvedCookieName, seenCookieDays);
      setHasSeenLogo(true);
    }
    onClick?.();
  };

  return { imageRef, hasSeenLogo, triggerWiggle, handleClick };
}
