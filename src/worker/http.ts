import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An error whose Chinese message is safe to show to the user as-is. */
export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const invalidLink = () => new HttpError(404, "invalid_link", "链接无效，请联系群主");
export const badRequest = (message: string) => new HttpError(400, "bad_request", message);

/** Reads a JSON body, treating anything malformed as an empty object so field checks report it. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const str = (v: unknown): string => (typeof v === "string" ? v : "");
