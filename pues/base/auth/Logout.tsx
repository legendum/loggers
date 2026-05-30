import { usePuesFetch } from "../core/Pues";

export type LogoutProps = {
  /** Logout endpoint. Defaults to `/pues/auth/logout` (the route mounted
   * by `mountAuthRoutes`). Override for a consumer on a different path. */
  endpoint?: string;
  /** Override the `fetch` implementation. Falls back to the value from
   * `<Pues fetch={...}>`, then the global `fetch`. */
  fetch?: typeof fetch;
};

/**
 * Fixed bottom-left "Logout" link. POSTs to the auth logout route and
 * reloads. Pairs with the bottom-centre <ThemeChooser> dock and the
 * bottom-right <AddButton> FAB — all three read `--pues-fab-offset`, so
 * they sit the same distance above the viewport bottom (left / centre /
 * right). Muted text that turns danger-red on hover.
 */
export function Logout({
  endpoint = "/pues/auth/logout",
  fetch: fetchOverride,
}: LogoutProps = {}) {
  const fetchImpl = usePuesFetch(fetchOverride);

  function logout() {
    fetchImpl(endpoint, {
      method: "POST",
      credentials: "include",
    }).finally(() => window.location.reload());
  }

  return (
    <button type="button" className="pues-logout" onClick={logout}>
      Logout
    </button>
  );
}
