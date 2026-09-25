import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./_core/env";
import { isStorageConfigured, storageGetSignedUrl, storagePut } from "./storage";

describe("S3-compatible storage backend", () => {
  const original = { ...ENV };

  beforeEach(() => {
    Object.assign(ENV, {
      s3Endpoint: "https://account123.r2.cloudflarestorage.com",
      s3Region: "auto",
      s3Bucket: "tafsell-docs",
      s3AccessKeyId: "AKIDEXAMPLE",
      s3SecretAccessKey: "secretexample",
      forgeApiUrl: "",
      forgeApiKey: "",
    });
  });

  afterEach(() => {
    Object.assign(ENV, original);
    vi.restoreAllMocks();
  });

  it("uploads with PutObject and returns a private proxy URL", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    const stored = await storagePut("org/7/staff/3/contract.pdf", Buffer.from("pdf"), "application/pdf");
    expect(stored.key).toMatch(/^org\/7\/staff\/3\/contract_[0-9a-f]{8}\.pdf$/);
    expect(stored.url).toBe(`/manus-storage/${stored.key}`);
    const command = send.mock.calls[0]![0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({ Bucket: "tafsell-docs", Key: stored.key, ContentType: "application/pdf" });
  });

  it("presigns short-lived download URLs against the configured bucket", async () => {
    const url = new URL(await storageGetSignedUrl("org/7/staff/3/contract_abcd1234.pdf"));
    expect(url.origin).toBe("https://account123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/tafsell-docs/org/7/staff/3/contract_abcd1234.pdf");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("reports storage as unconfigured when neither backend is set", () => {
    expect(isStorageConfigured()).toBe(true);
    Object.assign(ENV, { s3Bucket: "" });
    expect(isStorageConfigured()).toBe(false);
  });
});
