/**
 * HTTP helpers shared by all routes.
 */
import { NextFunction, Request, RequestHandler, Response } from "express";

/** Error carrying an HTTP status, rendered as-is by the global error handler. */
export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
    this.name = "HttpError";
  }
}

/** Extracts a readable message from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wraps an async route so rejected promises reach Express' error handler
 * (Express 4 does not do this by itself).
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
