export interface ExternalIntegrationAdapter {
  name: "gestao" | "google-drive" | "gmail" | "google-calendar" | "redcap" | "supabase-externo";
  enabled: boolean;
  healthCheck(): Promise<{ ok: boolean; message: string }>;
}

export const plannedIntegrations: ExternalIntegrationAdapter[] = [
  { name: "gestao", enabled: false, healthCheck: async () => ({ ok: false, message: "Pendente de contrato de API." }) },
  { name: "google-drive", enabled: false, healthCheck: async () => ({ ok: false, message: "Pendente de OAuth." }) },
  { name: "gmail", enabled: false, healthCheck: async () => ({ ok: false, message: "Pendente de OAuth." }) },
  { name: "google-calendar", enabled: false, healthCheck: async () => ({ ok: false, message: "Pendente de OAuth." }) },
  { name: "redcap", enabled: false, healthCheck: async () => ({ ok: false, message: "Pendente de token REDCap." }) },
  { name: "supabase-externo", enabled: false, healthCheck: async () => ({ ok: false, message: "Pendente de credenciais." }) }
];
