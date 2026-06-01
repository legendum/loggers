export type Row<T extends Record<string, unknown> = Record<string, unknown>> = {
  id: string | number;
  label?: string;
  position: number;
  parent_id?: string | number;
  updated_at?: number | string;
  created_at?: number | string;
  meta?: Record<string, unknown>;
  slug?: string;
} & T;

export type CountsRow = {
  parent_id: string | number | null;
  value: string;
  n: number;
  [key: string]: unknown;
};

export type UseResourceResult<T = Row> = {
  rows: T[];
  loading: boolean;
  error: Error | null;
  mutate: (next: T[] | ((prev: T[]) => T[])) => void;
  reload: () => void;
  loadMore: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  newOpId: () => string;
};

export function AddButton(props: {
  onCreated?: (row: Row) => void;
  [key: string]: unknown;
}): any;
export const Dialog: any;
export const DragHandle: any;
export const FilterBar: any;
export const LogoButton: any;
export const useLogoButton: any;
export const ObjectDetail: any;
export const RenameTitle: any;
export const TopBar: any;

export function broadcastRow(...args: any[]): any;
export function broadcastDelete(...args: any[]): any;
export function toWire(...args: any[]): any;
export function loadPuesConfig(...args: any[]): any;
export function resolveColumns(...args: any[]): any;
export type BeforeInsertContext = any;
export type BeforeInsertHook = (ctx: BeforeInsertContext) => any;
export type BeforeUpdateContext = any;
export type BeforeUpdateHook = (ctx: BeforeUpdateContext) => any;
export type BeforeDeleteContext = any;
export type BeforeDeleteHook = (ctx: BeforeDeleteContext) => any;
export function mountResource(opts: {
  beforeInsert?: BeforeInsertHook;
  beforeUpdate?: BeforeUpdateHook;
  beforeDelete?: BeforeDeleteHook;
  [key: string]: unknown;
}): any;

export function useCounts<T extends CountsRow = CountsRow>(...args: any[]): {
  rows: T[];
  [key: string]: unknown;
};
export function useDelete<T = Row>(...args: any[]): {
  del: (id: any) => any;
  [key: string]: unknown;
};
export function useDndPositions<T = Row>(...args: any[]): {
  onDragEnd: (event: any) => void;
  itemIds: string[];
  [key: string]: unknown;
};
export function useEscape(...args: any[]): any;
export function useFilter<T>(
  rows: T[],
  query: string,
  matcher: (row: T, query: string) => boolean,
): { active: boolean; visibleRows: T[] };
export function useFilterEnter(opts: {
  inputRef?: import("react").RefObject<HTMLInputElement | null>;
  active: boolean;
  onEnter: () => void;
}): void;
export function useFilterQuery(...args: any[]): [string, (value: any) => void];
export function useRename<T = Row>(...args: any[]): {
  rename: (id: any, label: string, extra?: Record<string, unknown>) => any;
  [key: string]: unknown;
};
export function useResource<T = Row>(...args: any[]): UseResourceResult<T>;
export type OfflineRowCache<Cached = Row> = {
  write: (rows: Cached[]) => Promise<void>;
  read: () => Promise<Cached[] | null>;
  findBy: <K extends keyof Cached>(
    field: K,
    value: Cached[K],
  ) => Promise<Cached | null>;
};
export type UseOfflineRowCacheOptions<T = Row, Cached = T> = {
  dbName: string;
  metaKey: string;
  project?: (row: T) => Cached;
  enabled?: boolean;
};
export function createOfflineRowCache<T = Row, Cached = T>(opts: {
  dbName: string;
  metaKey: string;
  project?: (row: T) => Cached;
}): OfflineRowCache<Cached>;
export function useOfflineRowCache<T = Row, Cached = T>(
  resource: UseResourceResult<T>,
  options: UseOfflineRowCacheOptions<T, Cached>,
): OfflineRowCache<Cached>;
export function useSlugRouting<T = Row>(opts: {
  resource: UseResourceResult<T>;
  enabled: boolean;
  excludePathPrefixes?: string[];
  resolveExternal?: (slug: string) => Promise<T | null>;
  onSlugChanged?: (oldSlug: string, newSlug: string) => void;
}): {
  selected: T | null;
  select: (row: T) => void;
  goBack: () => void;
  filterQuery: string;
  setFilterQuery: (next: string | ((prev: string) => string)) => void;
};
export function resolveSlugSelection<R = Row>(opts: {
  rows: R[];
  slug: string | null;
  currentSelectedId: string | number | null;
}):
  | { action: "clear" }
  | { action: "hold" }
  | { action: "select"; row: R; replaceUrl: string | null };
export function getSlugFromPath(excludePathPrefixes?: string[]): string | null;
export function toSlug(label: string): string;
export function useSwipeToReveal(...args: any[]): any;
