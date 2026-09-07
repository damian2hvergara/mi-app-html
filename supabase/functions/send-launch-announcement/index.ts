/**
 * send-launch-announcement — IAC Arica 2026
 * Anuncio puntual (no reutilizable) del lanzamiento oficial del sorteo y
 * la nueva fecha de cierre de venta, a cada comprador confirmado hasta
 * la fecha. Lo dispara el admin manualmente desde stamper-admin.html —
 * un solo envío, no un cron.
 *
 * La fecha de cierre se lee en vivo de sorteo_config (no está hardcodeada)
 * para que el texto del correo nunca quede desalineado si la fecha vuelve
 * a ajustarse antes de terminar el envío.
 *
 * Mismo criterio de autorización que send-referral-nudge (parte 27): exige
 * JWT de una sesión real de Supabase Auth cuyo email esté en admin_emails
 * — nadie más puede disparar un envío masivo a toda la base de compradores.
 *
 * Secrets necesarios: RESEND_API_KEY, RESEND_FROM.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logEvent, logRepeatedAttempt } from '../_shared/log-event.ts';

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const adminClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const authHeader = req.headers.get('Authorization') || '';
  const callerToken = authHeader.replace(/^Bearer\s+/i, '');
  const anonClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data: userData, error: userErr } = await anonClient.auth.getUser(callerToken);
  const callerEmail = userData?.user?.email?.toLowerCase();
  if (userErr || !callerEmail) {
    await logRepeatedAttempt(adminClient, {
      source: 'send-launch-announcement',
      message: 'Llamada sin sesión válida a send-launch-announcement.',
    });
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const { data: adminRow, error: adminErr } = await adminClient.from('admin_emails').select('email').eq('email', callerEmail).maybeSingle();
  if (adminErr) {
    console.error('send-launch-announcement: error consultando admin_emails:', adminErr);
    return new Response(JSON.stringify({ error: 'error_verificando_admin' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!adminRow) {
    await logEvent(adminClient, {
      category: 'security', severity: 'high', source: 'send-launch-announcement',
      message: 'Sesión válida pero fuera de admin_emails intentó usar send-launch-announcement.',
      detail: { email: callerEmail },
    });
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
  }

  const { email } = body;
  const nombre = escapeHtml(body.nombre);
  if (!body.nombre || !email) {
    return new Response('Faltan datos', { status: 400, headers: corsHeaders });
  }

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
  const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'noreply@iac-arica.cl';

  // Fecha de cierre en vivo — nunca hardcodeada, para que el correo no
  // quede desalineado si se ajusta la fecha de nuevo durante el envío.
  const { data: sorteoRows } = await adminClient
    .from('sorteo_config')
    .select('fecha_venta_cierre')
    .eq('activo', true)
    .order('id', { ascending: false })
    .limit(1);
  const cierreRaw = sorteoRows?.[0]?.fecha_venta_cierre;
  const cierreTexto = cierreRaw
    ? new Date(cierreRaw + 'T12:00:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'la nueva fecha informada en el sitio';

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0C0C0C;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0C0C0C;padding:32px 0;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

  <tr><td style="background:linear-gradient(135deg,#161616,#1a0a02);border:1px solid #2a2a2a;border-radius:16px 16px 0 0;padding:32px 28px 24px;text-align:center;">
    <p style="font-family:'Arial Black',sans-serif;font-size:22px;font-weight:900;color:#fff;margin:0 0 6px;"><span style="color:#9B0000;">Import</span> American Cars</p>
    <p style="font-family:monospace;font-size:10px;color:rgba(201,168,76,0.7);letter-spacing:2px;text-transform:uppercase;margin:0 0 24px;">ARICA · CHILE</p>
    <div style="width:64px;height:64px;border-radius:50%;background:rgba(240,208,128,0.15);border:2px solid rgba(240,208,128,0.4);margin:0 auto 16px;text-align:center;line-height:62px;font-size:28px;">🏁</div>
    <h1 style="font-family:'Arial Black',sans-serif;font-size:24px;font-weight:900;color:#fff;margin:0 0 8px;">¡Hoy lanzamos oficialmente el Sorteo!</h1>
    <p style="font-size:14px;color:#6E6E6E;margin:0;line-height:1.6;">
      Hola <strong style="color:#F2F2F2;">${nombre}</strong>, hoy es el lanzamiento oficial del
      <strong style="color:#F0D080;">Sorteo IAC Arica 2026 — No sueñes, gánatelo</strong>, y
      queremos que seas de los primeros en saberlo, porque ya eres parte de esto.
    </p>
  </td></tr>

  <tr><td style="background:#161616;border-left:1px solid #2a2a2a;border-right:1px solid #2a2a2a;padding:24px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#202020;border:1px solid #2a2a2a;border-radius:10px;padding:18px 16px;">
      <tr><td>
        <p style="font-size:13.5px;color:#F2F2F2;margin:0 0 12px;line-height:1.6;">
          Tu Sticker Digital ya está confirmado y participando en el sorteo — <strong style="color:#F0D080;">eso no cambia en nada</strong>.
          Te contamos con toda transparencia: el sistema de compra quedó activo antes de este
          lanzamiento oficial por un tema interno de programación, así que si compraste en
          estos días previos, tu participación es completamente válida, con el mismo folio y
          las mismas condiciones que todos.
        </p>
        <p style="font-size:13.5px;color:#F2F2F2;margin:0;line-height:1.6;">
          Para que todos —tú incluido— aprovechen el período completo de la campaña desde su
          lanzamiento real, <strong style="color:#F0D080;">extendimos el cierre de venta hasta
          el ${cierreTexto}</strong>. Más tiempo para invitar amigos, sumar estampillas de
          regalo y subir en el ranking de referidos.
        </p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="background:rgba(155,0,0,0.12);border-left:1px solid #2a2a2a;border-right:1px solid #2a2a2a;padding:14px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><p style="font-size:11px;color:#9B0000;text-transform:uppercase;letter-spacing:1px;margin:0 0 3px;font-weight:700;">🏆 Premio del sorteo</p>
        <p style="font-family:'Arial Black',sans-serif;font-size:17px;color:#fff;margin:0;font-weight:900;">Dodge Challenger 2018</p></td>
      <td align="right"><p style="font-size:11px;color:#6E6E6E;margin:0 0 3px;">Nuevo cierre de venta</p>
        <p style="font-family:monospace;font-size:13px;color:#F0D080;font-weight:700;margin:0;">${cierreTexto}</p></td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#161616;border-left:1px solid #2a2a2a;border-right:1px solid #2a2a2a;padding:20px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(233,200,118,0.08);border:1px solid rgba(233,200,118,0.3);border-radius:10px;padding:16px;">
      <tr><td style="text-align:center;">
        <p style="font-family:'Arial Black',sans-serif;font-size:13px;font-weight:900;color:#F0D080;margin:0 0 6px;text-transform:uppercase;">🏆 Invita y gana hasta $300.000</p>
        <p style="font-size:12.5px;color:#F2F2F2;margin:0;line-height:1.5;">
          Los 3 que más refieran ganan dinero en efectivo el día del sorteo — 1° $300.000 ·
          2° $150.000 · 3° $50.000. Con más tiempo de campaña, es el mejor momento para
          compartir tu link y subir en el ranking.
        </p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="background:#161616;border-left:1px solid #2a2a2a;border-right:1px solid #2a2a2a;padding:0 20px 24px;text-align:center;">
    <p style="font-size:13px;color:#6E6E6E;margin:20px 0 14px;">Revisa tus estampillas o comparte tu link 👇</p>
    <a href="https://iac-arica.cl/mi-cuenta.html" style="display:inline-block;background:#9B0000;color:#fff;font-family:'Arial Black',sans-serif;font-size:14px;font-weight:900;padding:14px 28px;border-radius:999px;text-decoration:none;margin:0 6px 10px;">Ver mis estampillas</a>
    <a href="https://iac-arica.cl/mis-referidos.html" style="display:inline-block;background:#202020;border:1px solid #2a2a2a;color:#F0D080;font-family:'Arial Black',sans-serif;font-size:14px;font-weight:900;padding:14px 28px;border-radius:999px;text-decoration:none;margin:0 6px 10px;">Ver mi ranking</a>
  </td></tr>

  <tr><td style="background:#161616;border:1px solid #2a2a2a;border-radius:0 0 16px 16px;padding:20px 28px;text-align:center;">
    <p style="font-family:'Arial Black',sans-serif;font-size:16px;font-weight:900;color:#fff;margin:0 0 6px;"><span style="color:#9B0000;">Import</span> American Cars</p>
    <p style="font-size:11px;color:#3E3E3E;margin:0;line-height:1.8;">
      Arica, Chile · <a href="https://iac-arica.cl" style="color:#6E6E6E;text-decoration:none;">iac-arica.cl</a> ·
      <a href="https://iac-arica.cl/bases.html" style="color:#6E6E6E;text-decoration:none;">Bases del sorteo</a><br>
      Recibiste este correo porque tienes al menos un Sticker Digital confirmado en el Sorteo IAC Arica 2026.
    </p>
  </td></tr>

</table></td></tr></table>
</body></html>`;

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Import American Cars <${RESEND_FROM}>`,
        to: [email],
        subject: '🏁 ¡Hoy lanzamos oficialmente el Sorteo! + nueva fecha de cierre',
        html,
      }),
    });

    if (!resendRes.ok) {
      const err = await resendRes.text();
      console.error('Resend error:', err);
      return new Response(JSON.stringify({ error: err }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await resendRes.json();
    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e: any) {
    console.error('Error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
