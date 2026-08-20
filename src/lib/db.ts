import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

let adminClient: SupabaseClient | null = null;

/**
 * 服务端专用 Supabase client（service_role，绕过 RLS）。
 * 只允许在 server-only 代码路径使用；任何写操作必须显式带 book_id。
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

/**
 * 已登录用户的 Supabase client（anon key + RLS）。
 * M0 单人自用阶段可以先不做登录，全部走 admin client；
 * 此函数是 RLS 路径的占位，M1 接入 auth 后启用。
 */
export function getSupabaseUserClient(): SupabaseClient {
  const url = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");

  return createClient(url, anonKey);
}
