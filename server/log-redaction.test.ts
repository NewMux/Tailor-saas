/**
 * Request logs must never contain credentials: session tokens (Authorization
 * header, Cookie, Set-Cookie), one-time tokens in query strings, or the
 * parameters of a failed SQL statement (which can hold a password hash).
 */
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Writable } from "node:stream";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpLogger, createLogger, redactErrorMessage } from "./_core/logger";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { lines, stream };
}

describe("log redaction", () => {
  const { lines, stream } = capture();
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(createHttpLogger(createLogger(stream)));
    app.get("/api/auth/invite", (_req, res) => {
      res.setHeader("Set-Cookie", "erp_session=SETCOOKIESECRET; HttpOnly");
      res.json({ ok: true });
    });
    server = createServer(app).listen(0);
    await once(server, "listening");
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    await fetch(`${base}/api/auth/invite?token=INVITESECRET`, {
      headers: { Authorization: "Bearer BEARERSECRET", Cookie: "erp_session=COOKIESECRET" },
    });
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  afterAll(() => {
    server.close();
  });

  it("logs the request", () => {
    expect(lines.join("")).toContain("/api/auth/invite");
  });

  it.each(["BEARERSECRET", "COOKIESECRET", "SETCOOKIESECRET", "INVITESECRET"])("never writes %s", secret => {
    expect(lines.join("")).not.toContain(secret);
  });

  it("strips SQL parameters from failed-query errors", () => {
    const message = "Failed query: insert into \"users\" (\"passwordHash\") values ($1)\nparams: $scrypt$salt$hash";
    expect(redactErrorMessage(message)).not.toContain("$scrypt$");
    expect(redactErrorMessage(message)).toContain("Failed query");
  });

  it("redacts error params when an error is logged", () => {
    const { lines: errLines, stream: errStream } = capture();
    createLogger(errStream).error({ err: new Error("Failed query: x\nparams: HUNTER2") }, "boom");
    expect(errLines.join("")).not.toContain("HUNTER2");
  });
});
