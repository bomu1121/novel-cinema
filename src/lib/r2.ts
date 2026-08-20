import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * 本地媒体存储（个人单机版）：文件落在 public/storage/ 下，
 * 浏览器直接通过 /storage/<key> 访问。保留 R2 时代的函数名，上层无需改动。
 */

const storageRoot = path.join(process.cwd(), "public", "storage");

function localPath(key: string): string {
  const safe = key.replace(/\\/g, "/").replace(/^\/+/, "");
  return path.join(storageRoot, safe);
}

/** 上传一段字节到本地媒体库 */
export async function r2Put(
  key: string,
  body: Uint8Array | Buffer,
  _contentType?: string,
): Promise<void> {
  void _contentType;
  const target = localPath(key);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, body);
}

/** 本地版没有过期概念，直接返回可访问 URL */
export async function r2SignedUrl(key: string, _expiresInSec = 3600): Promise<string> {
  void _expiresInSec;
  return `/storage/${key.replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

/** 公开 URL 同样指向本地静态目录 */
export function r2PublicUrl(key: string): string {
  return `/storage/${key.replace(/\\/g, "/").replace(/^\/+/, "")}`;
}
