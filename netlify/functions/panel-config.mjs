export default async () => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? Response.json({ url, key }, { headers: { 'cache-control': 'no-store' } }) : new Response(JSON.stringify({ error: 'Panel no configurado.' }), { status: 503 });
};
