export type Broadcast = (
  userId: number,
  event: string,
  data: unknown,
  opts?: { op_id?: string | null },
) => void;

export function sseRoute(...args: any[]): {
  routes: Record<string, unknown>;
  broadcast: Broadcast;
  streamCount: () => number;
};

export type SseEventHandler = (
  data: unknown,
  opts: { op_id: string | null },
) => void;

export type UseSSEOptions = {
  path?: string;
  enabled?: boolean;
};

export type UseSSEResult = {
  newOpId: () => string;
  forgetOpId: (opId: string) => void;
};

export function useSSE(
  handlers: Record<string, SseEventHandler>,
  options?: UseSSEOptions,
): UseSSEResult;
