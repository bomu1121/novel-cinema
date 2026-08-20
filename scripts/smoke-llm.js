// LLM 连通性冒烟测试：node --env-file=.env.local scripts/smoke-llm.js
const base = process.env.LLM_BASE_URL;
const key = process.env.LLM_API_KEY;
const model = process.env.LLM_CHEAP_MODEL || process.env.LLM_STRONG_MODEL;

async function main() {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "只输出一个合法 JSON 对象，不要解释。" },
        { role: "user", content: '输出 {"ok": true}' },
      ],
      max_tokens: 20,
      response_format: { type: "json_object" },
    }),
  });

  const text = await res.text();
  console.log("HTTP", res.status);
  console.log(text.slice(0, 400));
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
