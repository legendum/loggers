export type AdditionalAsset = {
  url: string;
  path: string;
};

export type ServiceWorkerInjection = {
  importScripts?: string[];
};

export type BuildServiceWorkerArgs = {
  root: string;
  cacheId: string;
  additionalAssets?: AdditionalAsset[];
  serviceWorker?: ServiceWorkerInjection;
};

export type BuildServiceWorkerResult = {
  count: number;
  size: number;
};

export type BuildPwaArgs = {
  root: string;
  cacheId?: string;
  additionalAssets?: AdditionalAsset[];
  serviceWorker?: ServiceWorkerInjection;
};

export type BuildPwaResult = BuildServiceWorkerResult & {
  manifestPath: string;
  manifestRevision: string;
};

export function buildPwa(args: BuildPwaArgs): Promise<BuildPwaResult>;
export function buildServiceWorker(
  args: BuildServiceWorkerArgs,
): Promise<BuildServiceWorkerResult>;
export function mountPwaRoutes(args: {
  root: string;
}): Promise<{
  routes: Record<string, () => Response | Promise<Response>>;
  fetch: (req: Request) => Promise<Response | null>;
}>;
export function ensurePwaIcons(args: {
  root: string;
  slug: string;
  icon192Url: string;
  icon512Url: string;
}): Promise<{ generated: { size: 192 | 512; path: string }[] }>;
