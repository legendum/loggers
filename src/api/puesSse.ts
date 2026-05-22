import { resolveUser } from "pues/base/auth/server";
import { sseRoute } from "pues/base/sse";

export const puesSse = sseRoute({ resolveUser });
