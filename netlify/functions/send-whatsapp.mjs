const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, N8N_WHATSAPP_SEND_WEBHOOK, N8N_WHATSAPP_WEBHOOK_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !N8N_WHATSAPP_SEND_WEBHOOK || !N8N_WHATSAPP_WEBHOOK_SECRET) {
    return json({ error: 'Envío no configurado.' }, 503);
  }

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Unauthorized' }, 401);
  // Todas las consultas a Supabase usan el token de quien está logueado: las políticas RLS deciden qué puede ver.
  const auth = { authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY };

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  const { conversationId, text, requestId } = body ?? {};
  const message = typeof text === 'string' ? text.trim() : '';
  if (!UUID.test(conversationId ?? '') || !UUID.test(requestId ?? '') || !message || message.length > 4096) {
    return json({ error: 'Invalid request' }, 400);
  }

  // 1) La conversación solo aparece si la persona tiene acceso al panel. El teléfono sale de la base, no del navegador.
  const convRes = await fetch(
    `${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conversationId}&select=empresa_id,cliente_id,clientes(telefono,whatsapp_id)`,
    { headers: auth },
  );
  if (convRes.status === 401) return json({ error: 'Unauthorized' }, 401);
  const [conv] = convRes.ok ? await convRes.json() : [];
  if (!conv) return json({ error: 'Conversation unavailable' }, 403);
  const to = String(conv.clientes?.whatsapp_id || conv.clientes?.telefono || '').replace(/\D/g, '');
  if (!/^[0-9]{8,18}$/.test(to)) return json({ error: 'Cliente sin teléfono válido.' }, 400);

  // 2) Mismo requestId ya registrado: respuesta idempotente, no se vuelve a enviar.
  const dupRes = await fetch(`${SUPABASE_URL}/rest/v1/mensajes?panel_request_id=eq.${requestId}&select=id`, { headers: auth });
  if (dupRes.ok && (await dupRes.json()).length) return json({ ok: true, duplicate: true });

  // 3) Envío por n8n (Cloud API de WhatsApp).
  let sent;
  try {
    sent = await fetch(N8N_WHATSAPP_SEND_WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-roya-webhook-secret': N8N_WHATSAPP_WEBHOOK_SECRET, 'idempotency-key': requestId },
      body: JSON.stringify({ conversationId, to, text: message, requestId }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return json({ error: 'No se pudo enviar el mensaje.' }, 502);
  }
  if (!sent.ok) return json({ error: 'No se pudo enviar el mensaje.' }, 502);
  const result = await sent.json().catch(() => ({}));

  // 4) Se registra en la conversación (política panel_insert_human_messages).
  const saved = await fetch(`${SUPABASE_URL}/rest/v1/mensajes`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      empresa_id: conv.empresa_id,
      conversacion_id: conversationId,
      cliente_id: conv.cliente_id,
      direccion: 'saliente',
      emisor: 'humano',
      tipo: 'texto',
      contenido_texto: message,
      estado_envio: result.status || 'enviado',
      meta_message_id: result.metaMessageId || null,
      panel_request_id: requestId,
    }),
  });
  if (saved.ok || saved.status === 409) return json({ ok: true, duplicate: saved.status === 409 });
  return json({ error: 'El mensaje se envió pero no quedó registrado.' }, 502);
};
