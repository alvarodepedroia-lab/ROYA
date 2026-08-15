# ROYA

## Panel privado

El panel está en `/panel/`; necesita las cuatro variables de `.env.example` configuradas en Netlify. En Supabase Auth agregá `https://royasanjuan.com/panel/` a Redirect URLs e invitá a `royacontroldeplagas.sj@gmail.com` (el acceso por enlace mágico no crea usuarios nuevos). Configurá n8n para validar `x-roya-webhook-secret`, enviar por Cloud API y devolver opcionalmente `metaMessageId` y `status`.

La migración `secure_roya_panel_access` ya fue aplicada al proyecto ROYA: habilita acceso por correo autorizado y empresa, RLS de lectura/actualización, y deduplicación mediante `panel_request_id`. No hay secretos en el repositorio.
