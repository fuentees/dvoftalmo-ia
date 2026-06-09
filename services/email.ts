const RESEND_URL = "https://api.resend.com/emails";

function isConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL);
}

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

async function send(payload: EmailPayload): Promise<void> {
  if (!isConfigured()) return;
  await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: "DvOftalmo IA <noreply@dvoftalmo.cc>",
      to: payload.to,
      subject: payload.subject,
      html: payload.html
    })
  }).catch(() => { /* non-critical */ });
}

export async function emailCorrectionReviewed(opts: {
  action: "approve" | "reject";
  fieldName: string;
  recordId: string;
  newValue: string;
  reviewerName: string;
}) {
  const label   = opts.action === "approve" ? "aprovada" : "rejeitada";
  const color   = opts.action === "approve" ? "#16a34a" : "#dc2626";
  await send({
    to:      process.env.NOTIFY_EMAIL!,
    subject: `[DvOftalmo] Correção CEVESP ${label} — registro ${opts.recordId}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:auto">
        <h2 style="color:${color}">Correção ${label}</h2>
        <p>O campo <strong>${opts.fieldName}</strong> do registro <strong>${opts.recordId}</strong>
           foi <strong>${label}</strong> por ${opts.reviewerName}.</p>
        <p>Novo valor proposto: <code>${opts.newValue}</code></p>
        <hr/>
        <p style="font-size:12px;color:#888">DvOftalmo IA · COS/DVSE/CVS</p>
      </div>`
  });
}

export async function emailCorrectionApplied(opts: {
  fieldName: string;
  recordId: string;
  oldValue: string;
  newValue: string;
  applierName: string;
}) {
  await send({
    to:      process.env.NOTIFY_EMAIL!,
    subject: `[DvOftalmo] Correção aplicada — registro ${opts.recordId}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:auto">
        <h2 style="color:#1a6654">Correção aplicada ao CEVESP</h2>
        <p>O campo <strong>${opts.fieldName}</strong> do registro <strong>${opts.recordId}</strong>
           foi alterado por ${opts.applierName}.</p>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:4px 8px;border:1px solid #ddd"><strong>Antes</strong></td><td style="padding:4px 8px;border:1px solid #ddd">${opts.oldValue}</td></tr>
          <tr><td style="padding:4px 8px;border:1px solid #ddd"><strong>Depois</strong></td><td style="padding:4px 8px;border:1px solid #ddd;color:#16a34a">${opts.newValue}</td></tr>
        </table>
        <hr/>
        <p style="font-size:12px;color:#888">DvOftalmo IA · COS/DVSE/CVS</p>
      </div>`
  });
}

export async function emailEpidAlert(opts: {
  gve: string;
  se: number;
  casesCurrent: number;
  casesAvg: number;
  increasePct: number;
  severity: "warning" | "critical";
}) {
  const color = opts.severity === "critical" ? "#dc2626" : "#d97706";
  const label = opts.severity === "critical" ? "CRÍTICO" : "ATENÇÃO";
  await send({
    to:      process.env.NOTIFY_EMAIL!,
    subject: `[DvOftalmo] Alerta epidemiológico ${label} — ${opts.gve} SE ${opts.se}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:auto">
        <h2 style="color:${color}">Alerta Epidemiológico — ${label}</h2>
        <p>A GVE <strong>${opts.gve}</strong> registrou aumento de
           <strong>${opts.increasePct.toFixed(0)}%</strong> na SE <strong>${opts.se}</strong>
           em relação à média das últimas 4 semanas.</p>
        <ul>
          <li>Casos SE ${opts.se}: <strong>${opts.casesCurrent}</strong></li>
          <li>Média 4 SE anteriores: <strong>${opts.casesAvg.toFixed(1)}</strong></li>
        </ul>
        <hr/>
        <p style="font-size:12px;color:#888">DvOftalmo IA · COS/DVSE/CVS</p>
      </div>`
  });
}
