import pino from "pino";
import { ENV } from "./env";

export const logger = pino({
  level: process.env.LOG_LEVEL || (ENV.isProduction ? "info" : "debug"),
});
