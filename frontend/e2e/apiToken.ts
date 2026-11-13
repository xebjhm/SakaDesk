// The per-launch API token the e2e backend is pinned to (security audit 2026-11-13).
// playwright.config.ts gives it to the test server and sends it as a header from every page;
// launch-auth.spec.ts drops that header and passes it in the #t= URL like SakaDesk's windows.
export const E2E_API_TOKEN = process.env.SAKADESK_API_TOKEN ?? 'e2e-local-api-token-0001'
