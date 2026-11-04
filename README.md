# ROYA

Sitio de Roya Manejo Integral (San Juan) y el panel **Staff** de la bandeja de WhatsApp.

## Panel Staff

Está en `/panel/` (botón **Staff** arriba a la derecha del sitio). Se ingresa con **usuario y contraseña**; el usuario `roya` se traduce internamente al email `roya@staff.royasanjuan.com`, que no es una casilla real.

Qué muestra:
- Todas las conversaciones del agente, las que requieren a una persona primero y resaltadas en naranja, las "listas para cotizar" en verde.
- Dentro de cada conversación, el mensaje que disparó la derivación marcado en naranja, junto con el motivo.
- Botón **Abrir en WhatsApp** (enlace `wa.me` con un saludo ya escrito), caja de respuesta que sale por el número del agente, y botón para apagar o reactivar el agente.
- Aviso de la ventana de 24 h de WhatsApp: pasado ese plazo solo se pueden enviar plantillas.

### Variables en Netlify (Site configuration → Environment variables)

Las cuatro de `.env.example`:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | URL del proyecto `royaagenteai` |
| `SUPABASE_PUBLISHABLE_KEY` | clave publishable (`sb_publishable_…`) |
| `N8N_WHATSAPP_SEND_WEBHOOK` | URL de producción del workflow `ROYA FINAL 07 - Envío desde panel` |
| `N8N_WHATSAPP_WEBHOOK_SECRET` | secreto largo, el mismo que en la credencial `ROYA - Panel Send Secret` de n8n |

### Supabase

1. Authentication → Users → crear el usuario con el email interno, contraseña elegida y **Auto Confirm User**.
2. Autorizarlo (una vez, en el SQL Editor):

```sql
insert into private.panel_access (empresa_id, email)
select id, 'roya@staff.royasanjuan.com' from public.empresas where slug = 'roya'
on conflict do nothing;
```

3. Conviene desactivar el registro público de usuarios en Authentication → Sign In / Providers.

### n8n

Importar `ROYA FINAL 07 - Envío desde panel` (webhook `roya-final-panel-send`) y crear la credencial **Header Auth** `ROYA - Panel Send Secret` con la cabecera `x-roya-webhook-secret`. En el nodo "Validar envío" está el `PHONE_NUMBER_ID` del número de WhatsApp desde el que responde el agente; hay que cambiarlo cuando se use el número definitivo.

No hay secretos en este repositorio.
