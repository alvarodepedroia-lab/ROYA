import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const STAFF_DOMAIN = 'staff.royasanjuan.com';
const REFRESH_MS = 10000;
const WINDOW_HOURS = 24;
const GREETING = 'Hola, ¿qué tal? Recibimos tu consulta en el agente de Roya y, como no pudo resolverla, te escribo yo.';
const READY_STATES = ['LISTO_PARA_COTIZAR', 'PENDIENTE_DE_COTIZACION'];

const $ = (s) => document.querySelector(s);
let db;
let conversations = [];
let pending = new Set();
let activeId = null;
let renderedId = null;

// Todo lo que escribe un cliente se inserta como texto, nunca como HTML.
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'onclick') n.onclick = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return n;
}

const toEmail = (user) => {
  const u = user.trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${STAFF_DOMAIN}`;
};
const fmt = (d) => (d ? new Date(d).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const digits = (v) => String(v ?? '').replace(/\D/g, '');
const latestRequest = (c) => [...(c.solicitudes || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;

async function init() {
  try {
    const cfg = await fetch('/.netlify/functions/panel-config').then((r) => r.json());
    if (!cfg.url || !cfg.key) throw new Error('sin configuración');
    db = createClient(cfg.url, cfg.key);
  } catch {
    $('#login-msg').textContent = 'El panel no está configurado todavía.';
    return;
  }
  $('#login-form').onsubmit = login;
  const { data: { session } } = await db.auth.getSession();
  if (session) show();
}

async function login(e) {
  e.preventDefault();
  $('#login-msg').textContent = '';
  const { error } = await db.auth.signInWithPassword({ email: toEmail($('#user').value), password: $('#pass').value });
  if (error) {
    $('#login-msg').textContent = 'Usuario o contraseña incorrectos.';
    return;
  }
  $('#pass').value = '';
  show();
}

async function show() {
  $('#login').hidden = true;
  $('#panel').hidden = false;
  $('#out').onclick = () => db.auth.signOut().then(() => location.reload());
  $('#q').oninput = renderList;
  $('#only-human').onchange = renderList;
  await refresh();
  setInterval(refresh, REFRESH_MS);
}

async function refresh() {
  await loadList();
  if (activeId) await loadThread(false);
}

async function loadList() {
  const [convs, pend] = await Promise.all([
    db.from('conversaciones')
      .select('id,estado,bot_activo,atencion_humana,ultima_actividad,clientes(id,nombre,telefono,whatsapp_id,nombre_empresa,email),solicitudes(id,numero_solicitud,servicio,estado,descripcion_problema,tipo_lugar,urgencia,fecha_deseada,motivo_derivacion,created_at)')
      .order('ultima_actividad', { ascending: false, nullsFirst: false })
      .limit(300),
    db.from('derivaciones').select('conversacion_id').eq('estado', 'PENDIENTE'),
  ]);
  if (convs.error) {
    $('#list').replaceChildren(el('p', { class: 'hint', style: 'padding:14px' }, 'Sesión vencida o sin autorización. Volvé a ingresar.'));
    return;
  }
  conversations = convs.data || [];
  pending = new Set((pend.data || []).map((d) => d.conversacion_id));
  renderList();
}

function flags(c) {
  const r = latestRequest(c);
  return {
    alert: pending.has(c.id) || c.atencion_humana,
    ready: !!r && READY_STATES.includes(r.estado),
    off: !c.bot_activo,
  };
}

function renderList() {
  const q = $('#q').value.trim().toLowerCase();
  const only = $('#only-human').checked;
  const rows = conversations.filter((c) => {
    const f = flags(c);
    if (only && !(f.alert || f.ready)) return false;
    if (!q) return true;
    const k = c.clientes || {}, r = latestRequest(c) || {};
    return [k.nombre, k.telefono, k.whatsapp_id, k.nombre_empresa, r.numero_solicitud, r.servicio].join(' ').toLowerCase().includes(q);
  });
  // Primero los que piden atención humana, después los listos para cotizar.
  rows.sort((a, b) => {
    const fa = flags(a), fb = flags(b);
    return (fb.alert - fa.alert) || (fb.ready - fa.ready) || (new Date(b.ultima_actividad) - new Date(a.ultima_actividad));
  });
  $('#list').replaceChildren(...rows.map((c) => {
    const k = c.clientes || {}, r = latestRequest(c), f = flags(c);
    const item = el('button', { class: 'item' + (f.alert ? ' alert' : f.ready ? ' ready' : '') + (c.id === activeId ? ' sel' : ''), type: 'button', onclick: () => openConversation(c.id) },
      el('div', { class: 'row' }, el('span', { class: 'name' }, k.nombre || k.telefono || 'Sin nombre'), el('small', {}, fmt(c.ultima_actividad))),
      el('small', {}, `${r?.numero_solicitud || 'Sin solicitud'}${r?.servicio ? ' · ' + r.servicio : ''}`));
    const badges = el('div');
    if (f.alert) badges.append(el('span', { class: 'badge' }, 'Requiere atención'), ' ');
    if (f.ready) badges.append(el('span', { class: 'badge ready' }, 'Listo para cotizar'), ' ');
    if (f.off) badges.append(el('span', { class: 'badge off' }, 'Agente apagado'));
    item.append(badges);
    return item;
  }));
}

async function openConversation(id) {
  activeId = id;
  renderedId = null;
  renderList();
  await loadThread(true);
}

async function loadThread(scrollToEnd) {
  const c = conversations.find((x) => x.id === activeId);
  if (!c) return;
  const [msgs, ders] = await Promise.all([
    db.from('mensajes')
      .select('id,direccion,emisor,tipo,contenido_texto,contenido_transcripto,estado_envio,created_at')
      .eq('conversacion_id', c.id).order('created_at', { ascending: true }).limit(800),
    db.from('derivaciones').select('id,motivo,estado,created_at').eq('conversacion_id', c.id).order('created_at', { ascending: true }),
  ]);
  if (renderedId !== c.id) {
    renderDetail(c);
    renderedId = c.id;
    scrollToEnd = true;
  }
  renderThread(msgs.data || [], ders.data || [], scrollToEnd);
  renderWindow(msgs.data || []);
}

function renderDetail(c) {
  const k = c.clientes || {}, r = latestRequest(c);
  const tel = digits(k.whatsapp_id || k.telefono);
  const detail = $('#detail');
  detail.replaceChildren(el('h2', {}, k.nombre || k.telefono || 'Sin nombre'));
  detail.append(el('p', { class: 'meta' }, [tel && '+' + tel, k.nombre_empresa, k.email].filter(Boolean).join(' · ')));

  const wa = el('a', { class: 'btn', target: '_blank', rel: 'noopener', href: tel ? `https://wa.me/${tel}?text=${encodeURIComponent(GREETING)}` : '#' }, 'Abrir en WhatsApp');
  const toggle = el('button', { class: 'alt', type: 'button' }, c.bot_activo ? 'Tomar atención humana (apaga el agente)' : 'Reactivar agente');
  toggle.onclick = () => setBot(c, !c.bot_activo);
  detail.append(el('div', { class: 'actions' }, wa, toggle));

  if (r) {
    const box = el('div', { class: 'box' }, el('h3', {}, `Solicitud ${r.numero_solicitud || ''}`));
    const rows = [['Estado', r.estado], ['Servicio', r.servicio], ['Problema', r.descripcion_problema], ['Lugar', r.tipo_lugar],
      ['Urgencia', r.urgencia], ['Fecha deseada', r.fecha_deseada], ['Motivo de derivación', r.motivo_derivacion]];
    for (const [label, v] of rows) if (v) box.append(el('p', {}, el('b', {}, label + ': '), v));
    detail.append(box);
  }

  detail.append(el('div', { class: 'thread', id: 'thread' }), el('div', { class: 'window', id: 'window' }));

  const textarea = el('textarea', { id: 'reply-text', placeholder: 'Respuesta por WhatsApp', required: '' });
  const send = el('button', { type: 'submit', id: 'reply-send' }, 'Enviar');
  const form = el('form', { class: 'reply', id: 'reply' }, textarea, send);
  form.onsubmit = sendReply;
  detail.append(form);
}

function renderThread(messages, derivations, scrollToEnd) {
  const box = $('#thread');
  if (!box) return;
  const nearEnd = box.parentElement.scrollHeight - box.parentElement.scrollTop - box.parentElement.clientHeight < 120;

  // El mensaje del cliente justo anterior a cada derivación es el "llamado".
  const called = new Set();
  for (const d of derivations) {
    const before = messages.filter((m) => m.direccion === 'entrante' && new Date(m.created_at) <= new Date(d.created_at));
    if (before.length) called.add(before[before.length - 1].id);
  }
  const items = [
    ...messages.map((m) => ({ t: new Date(m.created_at), m })),
    ...derivations.map((d) => ({ t: new Date(d.created_at), d })),
  ].sort((a, b) => a.t - b.t);

  box.replaceChildren(...items.map(({ m, d }) => {
    if (d) {
      return el('div', { class: 'notice' }, `Derivación a persona · ${d.estado === 'PENDIENTE' ? 'pendiente' : 'resuelta'}`,
        el('small', {}, `${fmt(d.created_at)}${d.motivo ? ' · ' + d.motivo : ''}`));
    }
    const text = m.contenido_texto || (m.contenido_transcripto ? '🎤 ' + m.contenido_transcripto : `[${m.tipo}]`);
    return el('div', { class: `msg ${m.emisor}${called.has(m.id) ? ' llamado' : ''}` }, text,
      el('small', {}, `${m.emisor} · ${fmt(m.created_at)}${m.estado_envio && !['enviado', 'recibido'].includes(m.estado_envio) ? ' · ' + m.estado_envio : ''}`));
  }));
  if (scrollToEnd || nearEnd) box.parentElement.scrollTop = box.parentElement.scrollHeight;
}

// Meta solo permite texto libre dentro de las 24 h posteriores al último mensaje del cliente.
function renderWindow(messages) {
  const info = $('#window');
  const send = $('#reply-send');
  if (!info) return;
  const last = [...messages].reverse().find((m) => m.direccion === 'entrante');
  const left = last ? WINDOW_HOURS * 3600e3 - (Date.now() - new Date(last.created_at)) : -1;
  const open = left > 0;
  info.className = 'window' + (open ? '' : ' closed');
  info.textContent = open
    ? `Podés responder desde acá durante ${Math.floor(left / 3600e3)} h ${Math.floor((left % 3600e3) / 60e3)} min más.`
    : 'Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite plantillas. Escribile con el botón "Abrir en WhatsApp".';
  send.disabled = !open;
}

async function sendReply(e) {
  e.preventDefault();
  const textarea = $('#reply-text'), send = $('#reply-send');
  const text = textarea.value.trim();
  if (!text) return;
  send.disabled = true;
  const { data: { session } } = await db.auth.getSession();
  let res;
  try {
    res = await fetch('/.netlify/functions/send-whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ conversationId: activeId, text, requestId: crypto.randomUUID() }),
    });
  } catch {
    alert('No se pudo enviar. Revisá tu conexión.');
    send.disabled = false;
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || 'No se pudo enviar el mensaje.');
    send.disabled = false;
    return;
  }
  textarea.value = '';
  send.disabled = false;
  await loadThread(true);
}

async function setBot(c, active) {
  const { error } = await db.from('conversaciones')
    .update({ bot_activo: active, atencion_humana: !active }).eq('id', c.id);
  if (error) { alert('No se pudo cambiar el estado.'); return; }
  if (active) {
    await db.from('derivaciones').update({ estado: 'RESUELTA', resolved_at: new Date().toISOString() })
      .eq('conversacion_id', c.id).eq('estado', 'PENDIENTE');
  }
  renderedId = null;
  await refresh();
}

init();
