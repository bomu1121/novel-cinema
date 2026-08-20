// 本地 SQLite 数据层冒烟测试：npx tsx scripts/smoke-db.ts
import { getSupabaseAdmin } from "../src/lib/db";

async function main() {
  const s = getSupabaseAdmin();
  const { data: book, error } = await s
    .from("books")
    .insert({ owner_id: "u1", title: "冒烟测试", total_chars: 3, status: "draft" })
    .select("id, title, status, created_at")
    .single();
  if (error) throw error;
  console.log("insert:", book);

  const { data: rows } = await s.from("books").select("id, title").eq("id", book.id);
  console.log("select:", rows);

  await s.from("books").delete().eq("id", book.id);
  const { data: after } = await s.from("books").select("id").eq("id", book.id);
  console.log("deleted?", after.length === 0);
}

main().catch((err) => {
  console.error("smoke-db 失败:", err);
  process.exit(1);
});
