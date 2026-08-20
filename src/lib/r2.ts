import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireEnv } from "./env";

let r2Client: S3Client | null = null;

export function getR2Client(): S3Client {
  if (r2Client) return r2Client;

  const accountId = requireEnv("R2_ACCOUNT_ID");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");

  r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return r2Client;
}

/** 上传一段字节。key 形如 "book/{bookId}/assets/{assetId}.png" */
export async function r2Put(
  key: string,
  body: Uint8Array | Buffer,
  contentType: string,
): Promise<void> {
  const bucket = requireEnv("R2_BUCKET");
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** 生成临时签名下载 URL（默认 1 小时）。M0 预览可直接用。 */
export async function r2SignedUrl(key: string, expiresInSec = 3600): Promise<string> {
  const bucket = requireEnv("R2_BUCKET");
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSec },
  );
}

/** 若配置了公开域名，生成永久公开 URL（适合成品发布与渲染 Job 拉取）。 */
export function r2PublicUrl(key: string): string {
  const base = requireEnv("R2_PUBLIC_URL").replace(/\/+$/, "");
  return `${base}/${key}`;
}
