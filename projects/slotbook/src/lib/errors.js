// One error type for everything the API reports on purpose. Anything else is
// a 500 with a generic message; details stay in the server log.
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    /** @type {number | undefined} */
    this.retryAfterSec = undefined;
  }
}

export const badRequest = (msg, details) => new ApiError(400, "bad_request", msg, details);
export const validation = (details) => new ApiError(422, "validation_failed", "Some fields are invalid.", details);
export const unauthorized = (msg = "Sign in to continue.") => new ApiError(401, "unauthorized", msg);
export const forbidden = (msg = "You don't have permission to do that.") => new ApiError(403, "forbidden", msg);
export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found.`);
export const conflict = (msg, code = "conflict") => new ApiError(409, code, msg);
export const tooMany = (retryAfterSec) =>
  Object.assign(new ApiError(429, "rate_limited", "Too many requests. Try again shortly."), { retryAfterSec });

/** Map known PostgreSQL errors to API errors. */
export function fromPg(err) {
  if (err?.name !== "PgError") return null;
  if (err.code === "23P01" && err.constraint === "bookings_no_overlap")
    return conflict("That time was just taken. Pick another slot.", "slot_taken");
  if (err.code === "23505") return conflict("That value is already in use.", "duplicate");
  if (err.code === "23503") return badRequest("A referenced record does not exist.");
  if (err.code === "23514" || err.code === "22P02" || err.code === "22007" || err.code === "22008")
    return badRequest("A value is outside the allowed range.");
  return null;
}
