export type PuesProps = any;
export type PuesUser = any;
export const Pues: any;
export function usePuesFetch(): typeof fetch;
export function usePuesUser(): any;

export function defaultRoot(): string;
export function defaultCoreName(root?: string): string;
export function resolveCoreName(
  config: { core?: { name?: unknown } } | null | undefined,
  root?: string,
): string;

export function isByLegendum(): boolean;
export function isSelfHosted(): boolean;
export const LOCAL_USER_EMAIL: string;
export function setByLegendum(value: boolean | null): void;

export function puesAuthedFetch(baseFetch?: typeof fetch): typeof fetch;

export function useOnlineStatus(): boolean;
export function usePageTitle(title: string): void;

/** Mint a ULID-compatible sortable id. `randomChars` defaults to 16 (26-char
 *  id); pass fewer for shorter ids. */
export function ulid(randomChars?: number): string;
/** Matches a standard 26-char id (first char 0-7). */
export const ULID_RE: RegExp;
/** Build a matcher for a non-standard total `length` (default 26). */
export function ulidPattern(length?: number): RegExp;
/** True if `value` is a standard 26-char ULID-compatible id. */
export function isUlid(value: string): boolean;

/** Consumer-app metadata derived from config/pues.yaml at vendor time.
 *  Empty in the pues source tree; populated when vendored into a consumer. */
export const puesAppMeta: {
  readonly name: string;
};
