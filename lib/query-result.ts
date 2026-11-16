type QuerySnapshot<T> = {
  data: T | undefined;
  isError: boolean;
  isPending?: boolean;
  isPlaceholderData?: boolean;
};

/** A cached result from a failed request must not be presented as the current result. */
export function currentQueryData<T>(query: QuerySnapshot<T>): T | undefined {
  return query.isError || query.isPending || query.isPlaceholderData ? undefined : query.data;
}

export function canExportQuery<T>(query: QuerySnapshot<T> & { isFetching: boolean }): boolean {
  return currentQueryData(query) != null && !query.isFetching;
}

/** Late responses and changed filters must not be reused for a different consultation. */
export function currentConsultationData<T extends { querySignature?: string }>(query: QuerySnapshot<T>, signature: string): T | undefined {
  const data = currentQueryData(query);
  return data?.querySignature === signature ? data : undefined;
}

/** HTTP and malformed JSON failures remain errors rather than successful empty responses. */
export async function fetchJson<T>(url: string, fallbackMessage: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(fallbackMessage);
  }
  if (!response.ok) {
    const error = body && typeof body === "object" ? body as Record<string, unknown> : undefined;
    const message = error?.message ?? error?.error;
    throw new Error(typeof message === "string" && message.trim() ? message : fallbackMessage);
  }
  return body as T;
}
