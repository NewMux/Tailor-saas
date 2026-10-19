import pino, { type DestinationStream } from "pino";
import pinoHttp from "pino-http";
import { ENV } from "./env";

/**
 * Drizzle puts the bound parameters in its error text ("Failed query: ...
 * params: ..."), which can include a password hash or personal data. Keep the
 * statement, drop the values.
 */
export function redactErrorMessage(message: string) {
  const index = message.indexOf("\nparams:");
  return index === -1 ? message : `${message.slice(0, index)}\nparams: [redacted]`;
}

function redactError(error: unknown) {
  const serialized = pino.stdSerializers.err(error as Error);
  return {
    ...serialized,
    message: redactErrorMessage(serialized.message ?? ""),
    stack: serialized.stack ? redactErrorMessage(serialized.stack) : serialized.stack,
  };
}

export function createLogger(destination?: DestinationStream) {
  return pino(
    {
      level: process.env.LOG_LEVEL || (ENV.isProduction ? "info" : "debug"),
      // Session tokens travel in these headers; logs are not a safe place for them.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'res.headers["set-cookie"]',
        ],
        censor: "[redacted]",
      },
      serializers: { err: redactError },
    },
    destination
  );
}

export const logger = createLogger();

/** Request logging without credentials: query strings (invite and reset tokens) are dropped. */
export function createHttpLogger(baseLogger = logger, options: { ignore?: (url: string) => boolean } = {}) {
  return pinoHttp({
    logger: baseLogger,
    autoLogging: { ignore: req => options.ignore?.(req.url ?? "") ?? false },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: (req.url ?? "").split("?")[0],
          headers: req.headers,
          remoteAddress: req.remoteAddress,
        };
      },
    },
  });
}
