// Private file storage (staff documents). Two interchangeable backends:
//   - any S3-compatible bucket (Cloudflare R2, AWS S3, Backblaze B2, ...)
//     when the S3_* settings are present: the production default;
//   - the legacy Manus Forge presign proxy when BUILT_IN_FORGE_API_* are set.
// Either way files are never public: stored objects are referenced as
// /manus-storage/{key}, which server/_core/storageProxy.ts serves by
// checking the caller's access and redirecting to a short-lived signed URL.

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV, isS3Configured } from "./_core/env";

const SIGNED_URL_TTL_SECONDS = 5 * 60;

let s3Client: S3Client | null = null;

function getS3Client() {
  s3Client ??= new S3Client({
    endpoint: ENV.s3Endpoint,
    region: ENV.s3Region,
    credentials: { accessKeyId: ENV.s3AccessKeyId, secretAccessKey: ENV.s3SecretAccessKey },
    // R2 and most non-AWS providers need path-style bucket addressing.
    forcePathStyle: true,
  });
  return s3Client;
}

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "File storage is not configured: set the S3_* variables (see DEPLOYMENT.md)",
    );
  }

  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

export function isStorageConfigured() {
  return isS3Configured() || Boolean(ENV.forgeApiUrl && ENV.forgeApiKey);
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));

  if (isS3Configured()) {
    await getS3Client().send(
      new PutObjectCommand({ Bucket: ENV.s3Bucket, Key: key, Body: typeof data === "string" ? Buffer.from(data) : data, ContentType: contentType }),
    );
    return { key, url: `/manus-storage/${key}` };
  }

  const { forgeUrl, forgeKey } = getForgeConfig();

  // 1. Get presigned PUT URL from Forge
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);

  const presignResp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }

  const { url: s3Url } = (await presignResp.json()) as { url: string };
  if (!s3Url) throw new Error("Forge returned empty presign URL");

  // 2. PUT file directly to S3
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });

  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });

  if (!uploadResp.ok) {
    throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  }

  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

/** A short-lived URL the browser can download the private object from. */
export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const key = normalizeKey(relKey);

  if (isS3Configured()) {
    return getSignedUrl(getS3Client(), new GetObjectCommand({ Bucket: ENV.s3Bucket, Key: key }), {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  }

  const { forgeUrl, forgeKey } = getForgeConfig();

  const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
  getUrl.searchParams.set("path", key);

  const resp = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
  }

  const { url } = (await resp.json()) as { url: string };
  if (!url) throw new Error("Storage backend returned an empty signed URL");
  return url;
}
