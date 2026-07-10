import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx";

export interface CanalEndemicoInput {
  lastSE: number;
  zona: "sucesso" | "alerta" | "epidemia";
  currentCases: number;
  q1: number;
  median: number;
  q3: number;
  weeksAboveQ3: number;
}

export interface BulletinInput {
  se: number;
  year: number;
  period: string;
  indicators: {
    totalCases: number;
    notifications: number;
    outbreakNotifications: number;
    outbreakTotal?: number;
    biologicalCollectionTotal: number;
    educationalActions: number;
    trainings: number;
    specializedReferrals: number;
    symptomaticStaffRemoval?: number;
    sexDistribution: Array<{ label: string; total: number }>;
    ageDistribution: Array<{ label: string; total: number }>;
    topMunicipalities: Array<{ name: string; total: number }>;
    topGves: Array<{ name: string; total: number }>;
  };
  alerts: Array<{ severity: string; title: string; description: string }>;
  interpretation: string[];
  recommendations: string[];
  canalEndemico?: CanalEndemicoInput;
}

const HEADER_FILL = "d1faf5";
const TEAL = "0f766e";
const GRAY = "666666";

function headerCell(text: string) {
  return new TableCell({
    shading: { fill: HEADER_FILL, type: ShadingType.CLEAR, color: "auto" },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text, bold: true, size: 20 })]
      })
    ]
  });
}

function dataCell(text: string, bold = false) {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text: String(text), bold, size: 20 })]
      })
    ]
  });
}

function kpiRow(label: string, value: string | number, label2?: string, value2?: string | number) {
  const cells = [dataCell(label, true), dataCell(String(value))];
  if (label2 !== undefined) {
    cells.push(dataCell(label2, true));
    cells.push(dataCell(String(value2 ?? "")));
  }
  return new TableRow({ children: cells });
}

function sectionHeading(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, bold: true, size: 26, color: TEAL })]
  });
}

function bodyText(text: string) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, size: 20 })]
  });
}

function spacer() {
  return new Paragraph({ children: [new TextRun("")] });
}

export async function generateBulletinDocx(data: BulletinInput): Promise<Buffer> {
  const ind = data.indicators;
  const outbreakRate = ind.notifications > 0
    ? `${((ind.outbreakNotifications / ind.notifications) * 100).toFixed(1)}%`
    : "N/A";

  const alertRows =
    data.alerts.length > 0
      ? data.alerts.map((alert) =>
          new TableRow({
            children: [
              dataCell(alert.severity.toUpperCase(), true),
              dataCell(alert.title, true),
              dataCell(alert.description)
            ]
          })
        )
      : [
          new TableRow({
            children: [
              dataCell("—"),
              dataCell("Nenhum alerta automatico identificado"),
              dataCell("")
            ]
          })
        ];

  const doc = new Document({
    sections: [
      {
        children: [
          // ── Cabecalho ──────────────────────────────────────────
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "BOLETIM EPIDEMIOLOGICO", bold: true, size: 36, color: TEAL })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
            children: [
              new TextRun({
                text: "Vigilancia Epidemiologica das Conjuntivites — Estado de Sao Paulo",
                size: 22
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
            children: [
              new TextRun({
                text: `SE ${String(data.se).padStart(2, "0")}/${data.year}  |  Periodo: ${data.period}  |  Emitido em: ${new Date().toLocaleDateString("pt-BR")}`,
                size: 20,
                color: GRAY
              })
            ]
          }),

          // ── 1. Indicadores principais ──────────────────────────
          sectionHeading("1. INDICADORES PRINCIPAIS"),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  headerCell("Indicador"),
                  headerCell("Valor"),
                  headerCell("Indicador"),
                  headerCell("Valor")
                ]
              }),
              kpiRow("Total de casos", ind.totalCases, "Notificacoes", ind.notifications),
              kpiRow("Notificacoes com surto", ind.outbreakNotifications, "Prop. surtos", outbreakRate),
              kpiRow("Total de surtos informados", ind.outbreakTotal ?? 0, "Coletas biologicas", ind.biologicalCollectionTotal),
              kpiRow("Acoes educativas", ind.educationalActions, "Treinamentos", ind.trainings),
              kpiRow("Afastamentos de sintomaticos", ind.symptomaticStaffRemoval ?? 0, "Encaminhamentos", ind.specializedReferrals)
            ]
          }),
          spacer(),

          // ── 2. Canal endemico (se disponivel) ─────────────────
          ...(data.canalEndemico
            ? [
                sectionHeading("2. CANAL ENDEMICO — SITUACAO DE ALERTA"),
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  rows: [
                    new TableRow({
                      children: [headerCell("Parametro"), headerCell("Valor"), headerCell("Parametro"), headerCell("Valor")]
                    }),
                    kpiRow("SE de referencia", data.canalEndemico.lastSE, "Zona atual", data.canalEndemico.zona.toUpperCase()),
                    kpiRow("Casos na SE", data.canalEndemico.currentCases, "Media historica", data.canalEndemico.median),
                    kpiRow("Limite de alerta", data.canalEndemico.q1, "Limite de epidemia", data.canalEndemico.q3),
                    kpiRow("Semanas acima do limite de epidemia no ano", data.canalEndemico.weeksAboveQ3, "", ""),
                  ]
                }),
                bodyText(
                  data.canalEndemico.zona === "epidemia"
                    ? `ATENCAO: a SE ${data.canalEndemico.lastSE} ultrapassou o limite de epidemia do canal endemico (${data.canalEndemico.q3}), configurando zona epidemica. Acionar protocolos de investigacao e controle.`
                    : data.canalEndemico.zona === "alerta"
                    ? `A SE ${data.canalEndemico.lastSE} encontra-se na zona de alerta (entre ${data.canalEndemico.q1} e ${data.canalEndemico.q3}). Intensificar monitoramento e preparar medidas preventivas.`
                    : `A SE ${data.canalEndemico.lastSE} encontra-se na zona de sucesso (abaixo de ${data.canalEndemico.q1}). Situacao dentro do esperado historicamente.`
                ),
                spacer()
              ]
            : []),

          // ── 3. Distribuicao demografica ────────────────────────
          sectionHeading("3. DISTRIBUICAO POR SEXO E FAIXA ETARIA"),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  headerCell("Sexo"),
                  headerCell("Casos"),
                  headerCell("Faixa Etaria"),
                  headerCell("Casos")
                ]
              }),
              ...Array.from(
                { length: Math.max(ind.sexDistribution.length, ind.ageDistribution.length) },
                (_, i) => {
                  const sex = ind.sexDistribution[i];
                  const age = ind.ageDistribution[i];
                  return new TableRow({
                    children: [
                      dataCell(sex?.label ?? ""),
                      dataCell(sex ? String(sex.total) : ""),
                      dataCell(age?.label ?? ""),
                      dataCell(age ? String(age.total) : "")
                    ]
                  });
                }
              )
            ]
          }),
          spacer(),

          // ── 4. Municipios ──────────────────────────────────────
          sectionHeading("4. MUNICIPIOS COM MAIOR NUMERO DE CASOS"),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [headerCell("Posicao"), headerCell("Municipio"), headerCell("Casos")] }),
              ...ind.topMunicipalities.slice(0, 10).map((m, i) =>
                new TableRow({
                  children: [dataCell(String(i + 1)), dataCell(m.name), dataCell(String(m.total))]
                })
              )
            ]
          }),
          spacer(),

          // ── 5. GVEs ────────────────────────────────────────────
          sectionHeading("5. GVEs COM MAIOR NUMERO DE CASOS"),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [headerCell("Posicao"), headerCell("GVE"), headerCell("Casos")] }),
              ...ind.topGves.slice(0, 10).map((g, i) =>
                new TableRow({
                  children: [dataCell(String(i + 1)), dataCell(g.name), dataCell(String(g.total))]
                })
              )
            ]
          }),
          spacer(),

          // ── 6. Alertas ─────────────────────────────────────────
          sectionHeading("6. ALERTAS EPIDEMIOLOGICOS"),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [headerCell("Severidade"), headerCell("Alerta"), headerCell("Descricao")]
              }),
              ...alertRows
            ]
          }),
          spacer(),

          // ── 7. Situacao epidemiologica ─────────────────────────
          sectionHeading("7. SITUACAO EPIDEMIOLOGICA"),
          ...data.interpretation.map(bodyText),
          spacer(),

          // ── 8. Recomendacoes ───────────────────────────────────
          sectionHeading("8. RECOMENDACOES"),
          ...data.recommendations.map((text, i) => bodyText(`${i + 1}. ${text}`)),
          spacer(),

          // ── Rodape ─────────────────────────────────────────────
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 400 },
            children: [
              new TextRun({
                text: "Centro de Vigilancia Epidemiologica | DVE/CEVESP | Secretaria de Estado da Saude de Sao Paulo",
                size: 18,
                color: GRAY
              })
            ]
          })
        ]
      }
    ]
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ── PDF ──────────────────────────────────────────────────────────────────────

export async function generateBulletinPdf(data: BulletinInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.create();
  const fontBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontNormal = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const teal   = rgb(0.059, 0.463, 0.431);
  const gray   = rgb(0.4, 0.4, 0.4);
  const black  = rgb(0, 0, 0);
  const white  = rgb(1, 1, 1);
  const tealBg = rgb(0.82, 0.98, 0.96);

  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN = 50;
  const COL_W  = PAGE_W - MARGIN * 2;

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  }

  function drawText(text: string, x: number, size: number, bold: boolean, color = black) {
    ensureSpace(size + 4);
    page.drawText(text, { x, y, size, font: bold ? fontBold : fontNormal, color });
    y -= size + 6;
  }

  function drawSectionHeading(text: string) {
    ensureSpace(28);
    y -= 8;
    page.drawRectangle({ x: MARGIN, y: y - 4, width: COL_W, height: 22, color: teal });
    page.drawText(text, { x: MARGIN + 6, y: y + 2, size: 13, font: fontBold, color: white });
    y -= 26;
  }

  function drawKvRow(label: string, value: string, label2?: string, value2?: string) {
    ensureSpace(20);
    const col = COL_W / 2;
    page.drawText(label, { x: MARGIN, y, size: 10, font: fontBold, color: black });
    page.drawText(value, { x: MARGIN + 120, y, size: 10, font: fontNormal, color: black });
    if (label2 !== undefined) {
      page.drawText(label2, { x: MARGIN + col, y, size: 10, font: fontBold, color: black });
      page.drawText(value2 ?? "", { x: MARGIN + col + 130, y, size: 10, font: fontNormal, color: black });
    }
    y -= 16;
  }

  function drawTableHeader(cols: string[], widths: number[]) {
    ensureSpace(22);
    let x = MARGIN;
    page.drawRectangle({ x: MARGIN, y: y - 4, width: COL_W, height: 18, color: tealBg });
    for (let i = 0; i < cols.length; i++) {
      page.drawText(cols[i], { x: x + 3, y: y, size: 9, font: fontBold, color: teal });
      x += widths[i];
    }
    y -= 20;
  }

  function drawTableRow(cells: string[], widths: number[], rowIdx: number) {
    ensureSpace(16);
    if (rowIdx % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: y - 3, width: COL_W, height: 14, color: rgb(0.96, 0.96, 0.96) });
    }
    let x = MARGIN;
    for (let i = 0; i < cells.length; i++) {
      page.drawText(cells[i].substring(0, 50), { x: x + 3, y, size: 9, font: fontNormal, color: black });
      x += widths[i];
    }
    y -= 15;
  }

  const ind = data.indicators;
  const outbreakRate = ind.notifications > 0
    ? `${((ind.outbreakNotifications / ind.notifications) * 100).toFixed(1)}%`
    : "N/A";

  // Title
  const title = "BOLETIM EPIDEMIOLOGICO";
  const titleW = fontBold.widthOfTextAtSize(title, 20);
  page.drawText(title, { x: (PAGE_W - titleW) / 2, y, size: 20, font: fontBold, color: teal });
  y -= 26;

  const sub = "Vigilancia Epidemiologica das Conjuntivites — Estado de Sao Paulo";
  const subW = fontNormal.widthOfTextAtSize(sub, 11);
  page.drawText(sub, { x: (PAGE_W - subW) / 2, y, size: 11, font: fontNormal, color: gray });
  y -= 18;

  const meta = `SE ${String(data.se).padStart(2, "0")}/${data.year}  |  ${data.period}  |  Emitido em: ${new Date().toLocaleDateString("pt-BR")}`;
  const metaW = fontNormal.widthOfTextAtSize(meta, 10);
  page.drawText(meta, { x: (PAGE_W - metaW) / 2, y, size: 10, font: fontNormal, color: gray });
  y -= 28;

  // 1. Indicadores principais
  drawSectionHeading("1. INDICADORES PRINCIPAIS");
  drawKvRow("Total de casos", String(ind.totalCases), "Notificacoes", String(ind.notifications));
  drawKvRow("Notif. com surto", String(ind.outbreakNotifications), "Prop. surtos", outbreakRate);
  drawKvRow("Total de surtos", String(ind.outbreakTotal ?? 0), "Coletas biologicas", String(ind.biologicalCollectionTotal));
  drawKvRow("Acoes educativas", String(ind.educationalActions), "Treinamentos", String(ind.trainings));
  drawKvRow("Afastamentos", String(ind.symptomaticStaffRemoval ?? 0), "Encaminhamentos", String(ind.specializedReferrals));
  y -= 8;

  // 2. Canal endêmico
  if (data.canalEndemico) {
    const c = data.canalEndemico;
    drawSectionHeading("2. CANAL ENDEMICO — SITUACAO DE ALERTA");
    drawKvRow("SE de referencia", String(c.lastSE), "Zona atual", c.zona.toUpperCase());
    drawKvRow("Casos na SE", String(c.currentCases), "Media historica", String(c.median));
    drawKvRow("Limite de alerta", String(c.q1), "Limite de epidemia", String(c.q3));
    drawKvRow("Semanas acima do limite de epidemia no ano", String(c.weeksAboveQ3), "", "");
    const alertMsg = c.zona === "epidemia"
      ? `ATENCAO: SE ${c.lastSE} ultrapassou o limite de epidemia (${c.q3}), zona epidemica. Acionar protocolos de controle.`
      : c.zona === "alerta"
      ? `SE ${c.lastSE} em zona de alerta (${c.q1} — ${c.q3}). Intensificar monitoramento.`
      : `SE ${c.lastSE} em zona de sucesso (abaixo de ${c.q1}). Situacao normal.`;
    drawText(alertMsg, MARGIN, 10, false, c.zona === "epidemia" ? rgb(0.7, 0.1, 0.1) : c.zona === "alerta" ? rgb(0.6, 0.4, 0) : teal);
    y -= 8;
  }

  // 3. Distribuição demográfica
  drawSectionHeading("3. DISTRIBUICAO POR SEXO E FAIXA ETARIA");
  const demoLen = Math.max(ind.sexDistribution.length, ind.ageDistribution.length);
  drawTableHeader(["Sexo", "Casos", "Faixa Etaria", "Casos"], [120, 80, 180, 115]);
  for (let i = 0; i < demoLen; i++) {
    const s = ind.sexDistribution[i];
    const a = ind.ageDistribution[i];
    drawTableRow([s?.label ?? "", s ? String(s.total) : "", a?.label ?? "", a ? String(a.total) : ""], [120, 80, 180, 115], i);
  }
  y -= 8;

  // 4. Municípios
  drawSectionHeading("4. MUNICIPIOS COM MAIOR NUMERO DE CASOS");
  drawTableHeader(["#", "Municipio", "Casos"], [30, 360, 105]);
  ind.topMunicipalities.slice(0, 10).forEach((m, i) => {
    drawTableRow([String(i + 1), m.name, String(m.total)], [30, 360, 105], i);
  });
  y -= 8;

  // 5. GVEs
  drawSectionHeading("5. GVEs COM MAIOR NUMERO DE CASOS");
  drawTableHeader(["#", "GVE", "Casos"], [30, 360, 105]);
  ind.topGves.slice(0, 10).forEach((g, i) => {
    drawTableRow([String(i + 1), g.name, String(g.total)], [30, 360, 105], i);
  });
  y -= 8;

  // 6. Alertas
  drawSectionHeading("6. ALERTAS EPIDEMIOLOGICOS");
  if (data.alerts.length === 0) {
    drawText("Nenhum alerta automatico identificado.", MARGIN, 10, false, gray);
  } else {
    drawTableHeader(["Sev.", "Alerta", "Descricao"], [60, 180, 255]);
    data.alerts.forEach((a, i) => {
      drawTableRow([a.severity.toUpperCase(), a.title, a.description], [60, 180, 255], i);
    });
  }
  y -= 8;

  // 7. Interpretação
  drawSectionHeading("7. SITUACAO EPIDEMIOLOGICA");
  data.interpretation.forEach((line) => drawText(line, MARGIN, 10, false));
  y -= 8;

  // 8. Recomendações
  drawSectionHeading("8. RECOMENDACOES");
  data.recommendations.forEach((line, i) => drawText(`${i + 1}. ${line}`, MARGIN, 10, false));
  y -= 16;

  // Footer on last page
  ensureSpace(20);
  const footer = "Centro de Vigilancia Epidemiologica | DVE/CEVESP | Secretaria de Estado da Saude de Sao Paulo";
  const footerW = fontNormal.widthOfTextAtSize(footer, 9);
  page.drawText(footer, { x: (PAGE_W - footerW) / 2, y: MARGIN, size: 9, font: fontNormal, color: gray });

  return pdfDoc.save();
}
