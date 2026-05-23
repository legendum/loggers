export type Row<T extends Record<string, unknown> = Record<string, unknown>> = {
  id: string | number;
  label: string;
  position: number;
  updated_at?: number;
  [key: string]: unknown;
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
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: (...args: any[]) => any;
  mutate?: (...args: any[]) => any;
  [key: string]: unknown;
};

export function AddButton(props: {
  onCreated?: (row: Row) => void;
  [key: string]: unknown;
}): any;
export const Dialog: any;
export const FilterBar: any;
export const ObjectDetail: any;
export const RenameTitle: any;

export function broadcastRow(...args: any[]): any;
export function broadcastDelete(...args: any[]): any;
export function toWire(...args: any[]): any;
export function loadPuesConfig(...args: any[]): any;
export function resolveColumns(...args: any[]): any;
export function mountResource(opts: {
  beforeInsert?: (args: { body: any; userId: any }) => any;
  beforeUpdate?: (args: { body: any; existing: any; userId: any }) => any;
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
export function useFilterQuery(...args: any[]): [string, (value: any) => void];
export function useRename<T = Row>(...args: any[]): {
  rename: (id: any, label: string, extra?: Record<string, unknown>) => any;
  [key: string]: unknown;
};
export function useResource<T = Row>(...args: any[]): UseResourceResult<T>;
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
export function useSwipeToReveal(...args: any[]): any;
