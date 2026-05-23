export function buildPwa(...args: any[]): any;
export function mountPwaRoutes(...args: any[]): any;
export function ensurePwaIcons(args: {
  root: string;
  slug: string;
  icon192Url: string;
  icon512Url: string;
}): Promise<{ generated: { size: 192 | 512; path: string }[] }>;
