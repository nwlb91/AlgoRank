import pino, { type LoggerOptions } from "pino";
import { config } from "./config.js";

const opts: LoggerOptions = { level: config.LOG_LEVEL };
if (process.stdout.isTTY) {
  opts.transport = {
    target: "pino-pretty",
    options: { colorize: true, translateTime: "HH:MM:ss.l" },
  };
}

export const log = pino(opts);
