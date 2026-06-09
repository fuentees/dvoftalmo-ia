export type UserRole = "admin" | "coordenador" | "supervisor" | "usuario";

export type DocumentCategory =
  | "tracoma"
  | "conjuntivite"
  | "treinamentos"
  | "relatorios"
  | "manuais"
  | "oficios"
  | "despachos"
  | "legislacao"
  | "outros";

export type AgentKind =
  | "documentos"
  | "email"
  | "treinamentos"
  | "campo"
  | "epidemiologico"
  | "geral"
  | "tracoma"
  | "dados"
  | "cos";

export type ExportFormat = "pdf" | "docx" | "xlsx" | "txt";

export interface AiSource {
  documentId: string;
  title: string;
  category: DocumentCategory;
  chunkId: string;
  score: number;
}

export interface ChatRequest {
  conversationId?: string;
  message: string;
  agent: AgentKind;
  fileIds?: string[];
}

export interface DashboardMetric {
  label: string;
  value: number;
  change: string;
}

// Tracoma / REDCap types
export interface TracomaSurveyResult {
  municipality: string;
  uf: string;
  examYear: number;
  totalExamined: number;
  tfCases: number;
  ttCases: number;
  tfPrevalence: number;
  ttPrevalence: number;
  whoTfThreshold: number;
  whoTtThreshold: number;
  tfEliminated: boolean;
  ttEliminated: boolean;
  azithromycinDoses: number;
  populationCoverage: number;
}

// Data analysis types
export interface ColumnStats {
  type: "numeric" | "categorical" | "date";
  count: number;
  missing: number;
  mean?: number;
  median?: number;
  stdDev?: number;
  min?: number;
  max?: number;
  q1?: number;
  q3?: number;
  frequencies?: Record<string, number>;
}

export interface ChartData {
  type: "bar" | "line" | "pie";
  title: string;
  data: Array<Record<string, string | number>>;
  xKey: string;
  yKeys: string[];
}

export interface CrossTabResult {
  rowVar: string;
  colVar: string;
  table: Record<string, Record<string, number>>;
}

export interface TrendResult {
  variable: string;
  timeColumn: string;
  points: Array<{ period: string; value: number }>;
}

export interface DataAnalysisResult {
  fileName: string;
  rows: number;
  columns: string[];
  summary: Record<string, ColumnStats>;
  charts: ChartData[];
  crossTabs: CrossTabResult[];
  trends: TrendResult[];
  interpretation: string[];
}

export const roleLabels: Record<UserRole, string> = {
  admin: "Administrador",
  coordenador: "Coordenador",
  supervisor: "Supervisor",
  usuario: "Usuario"
};

export const categoryLabels: Record<DocumentCategory, string> = {
  tracoma: "Tracoma",
  conjuntivite: "Conjuntivite",
  treinamentos: "Treinamentos",
  relatorios: "Relatorios",
  manuais: "Manuais",
  oficios: "Oficios",
  despachos: "Despachos",
  legislacao: "Legislacao",
  outros: "Outros"
};

export const agentLabels: Record<AgentKind, string> = {
  geral: "Geral",
  documentos: "Documentos",
  email: "E-mail",
  treinamentos: "Treinamentos",
  campo: "Campo",
  epidemiologico: "Epidemiologico CEVESP",
  tracoma: "Agente Tracoma",
  dados: "Agente de Dados",
  cos: "Agente COS"
};
