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
                    kpiRow("Casos na SE", data.canalEndemico.currentCases, "Mediana historica (P50)", data.canalEndemico.median),
                    kpiRow("Limite sucesso (P25)", data.canalEndemico.q1, "Limite alerta (P75)", data.canalEndemico.q3),
                    kpiRow("Semanas acima do P75 no ano", data.canalEndemico.weeksAboveQ3, "", ""),
                  ]
                }),
                bodyText(
                  data.canalEndemico.zona === "epidemia"
                    ? `ATENCAO: a SE ${data.canalEndemico.lastSE} ultrapassou o limite superior do canal endemico (Q3=${data.canalEndemico.q3}), configurando zona epidemica. Acionar protocolos de investigacao e controle.`
                    : data.canalEndemico.zona === "alerta"
                    ? `A SE ${data.canalEndemico.lastSE} encontra-se na zona de alerta (entre P25=${data.canalEndemico.q1} e P75=${data.canalEndemico.q3}). Intensificar monitoramento e preparar medidas preventivas.`
                    : `A SE ${data.canalEndemico.lastSE} encontra-se na zona de sucesso (abaixo de P25=${data.canalEndemico.q1}). Situacao dentro do esperado historicamente.`
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
