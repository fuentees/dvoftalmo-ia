/**
 * Cores dos gráficos, alinhadas à paleta do redesenho (analise-cevesp/design).
 * Séries que precisam ser distinguidas variam também em claridade, não só no tom.
 */
export const CHART = {
  primary: "#0B5D57",      // série principal (ano atual, casos)
  primarySoft: "#7CC4B7",  // série secundária da mesma família (projeção)
  primaryFill: "#CDE7E2",  // áreas e faixas (faixa esperada)
  accent: "#C4620F",       // comparação (ano anterior) e destaques
  alert: "#B42318",        // limites, taxas e alertas
  blue: "#1E4FD8",         // terceira série quando necessária
  ink: "#0F1E1A",          // linhas de referência fortes
  muted: "#52625D",        // médias e textos de apoio
  grid: "#E3E9E7"          // linhas de grade
} as const;

/** Paleta categórica para gráficos com muitas séries (ordem de uso). */
export const CHART_CATEGORICAL = [
  "#0B5D57", "#C4620F", "#1E4FD8", "#7CC4B7", "#B42318", "#8A6D1F",
  "#6B4FA3", "#52625D", "#2A8C7E", "#E3A06B", "#7C9CEB", "#A3A3A3"
];
