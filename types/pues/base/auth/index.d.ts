export type LegendumProps = any;
export const Legendum: any;
export type LoginScreenProps = {
  tagline: any;
  appName?: string;
  logoSrc?: string;
  className?: string;
  logoClassName?: string;
  legendumClassName?: string;
};
export function LoginScreen(props: LoginScreenProps): any;
export type LogoutProps = {
  endpoint?: string;
  fetch?: typeof fetch;
};
export function Logout(props?: LogoutProps): any;
export function useUser(opts?: { fetch?: typeof fetch }): {
  user: any;
  loading: boolean;
  setUser: (user: any) => void;
  refetch: () => Promise<void>;
};
