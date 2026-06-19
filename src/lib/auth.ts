// v0 one-password gate (NOT real auth). The gate is active only when APP_PASSWORD is set; otherwise
// the app is open (dev/sandbox). A single fixed user backs all rows.

export const SESSION_COOKIE = "armarium_session";

export function gateEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}
