export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Encrypts member link tokens and peppers the admin password hash. Generated once by CI. */
  TOKEN_KEY: string;
  /** Initial / recovery admin password, pushed from the GitHub secret on every deploy. */
  ADMIN_PASSWORD: string;
}
