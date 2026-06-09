export interface RedCapRecord {
  record_id: string;
  [field: string]: string | number | null;
}

export interface RedCapExportOptions {
  content?: "record" | "report" | "exportFieldNames" | "metadata";
  format?: "json" | "csv";
  type?: "flat" | "eav";
  records?: string[];
  fields?: string[];
  forms?: string[];
  filterLogic?: string;
  dateRangeBegin?: string;
  dateRangeEnd?: string;
  exportSurveyFields?: boolean;
}

function getApiUrl(): string {
  const url = process.env.REDCAP_API_URL;
  if (!url) throw new Error("REDCAP_API_URL nao configurado no .env.local");
  return url;
}

function getApiToken(): string {
  const token = process.env.REDCAP_API_TOKEN;
  if (!token) throw new Error("REDCAP_API_TOKEN nao configurado no .env.local");
  return token;
}

export async function redcapExport(options: RedCapExportOptions = {}): Promise<RedCapRecord[]> {
  const params = new URLSearchParams({
    token: getApiToken(),
    content: options.content ?? "record",
    format: options.format ?? "json",
    type: options.type ?? "flat",
    returnFormat: "json"
  });

  if (options.records?.length) params.set("records[0]", options.records.join(","));
  if (options.fields?.length) {
    options.fields.forEach((f, i) => params.set(`fields[${i}]`, f));
  }
  if (options.forms?.length) {
    options.forms.forEach((f, i) => params.set(`forms[${i}]`, f));
  }
  if (options.filterLogic) params.set("filterLogic", options.filterLogic);
  if (options.dateRangeBegin) params.set("dateRangeBegin", options.dateRangeBegin);
  if (options.dateRangeEnd) params.set("dateRangeEnd", options.dateRangeEnd);
  if (options.exportSurveyFields) params.set("exportSurveyFields", "true");

  const response = await fetch(getApiUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    throw new Error(`REDCap API erro HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json() as unknown;

  // REDCap returns error as { error: "..." } object
  if (data && typeof data === "object" && !Array.isArray(data) && "error" in data) {
    throw new Error(`REDCap: ${(data as { error: string }).error}`);
  }

  return (Array.isArray(data) ? data : []) as RedCapRecord[];
}

export function isRedCapConfigured(): boolean {
  return !!(process.env.REDCAP_API_URL && process.env.REDCAP_API_TOKEN);
}
