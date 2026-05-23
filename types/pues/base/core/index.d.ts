export type PuesProps = any;
export type PuesUser = any;
export const Pues: any;
export function usePuesFetch(): typeof fetch;
export function usePuesUser(): any;

export function defaultRoot(): string;
export function defaultCoreName(root?: string): string;

export function isByLegendum(): boolean;
export function isSelfHosted(): boolean;
export const LOCAL_USER_EMAIL: string;
export function setByLegendum(value: boolean | null): void;

export function puesAuthedFetch(baseFetch?: typeof fetch): typeof fetch;

export function useOnlineStatus(): boolean;
export function usePageTitle(title: string): void;

/** Consumer-app metadata derived from config/pues.yaml at vendor time.
 *  Empty in the pues source tree; populated when vendored into a consumer. */
export const puesAppMeta: {
  readonly name: string;
};
