import assert from "node:assert/strict";
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { canExportQuery, currentConsultationData, currentQueryData, fetchJson } from "../lib/query-result";

type Cases = Array<{ se: number; cases: number }>;
const fallback = "Consulta indisponível";
const initial: Cases = [{ se: 40, cases: 12 }];
const updated: Cases = [{ se: 40, cases: 15 }];

async function run() {
  const originalFetch = globalThis.fetch;
  let responseFor: (url: string) => Promise<Response> = async () => Response.json([]);
  let observedSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (input, init) => {
    observedSignal = init?.signal;
    return responseFor(String(input));
  };

  try {
    // Transport failures must never turn into an evaluated empty channel.
    responseFor = async () => Response.json([], { status: 503 });
    await assert.rejects(fetchJson<Cases>("/channel", fallback), { message: fallback });
    responseFor = async () => Response.json({ error: "Sessão expirada" }, { status: 401 });
    await assert.rejects(fetchJson<Cases>("/channel", fallback), { message: "Sessão expirada" });
    responseFor = async () => new Response("<html>proxy indisponível</html>", { status: 502 });
    await assert.rejects(fetchJson<Cases>("/channel", fallback), { message: fallback });
    responseFor = async () => new Response("JSON incompleto", { status: 200 });
    await assert.rejects(fetchJson<Cases>("/channel", fallback), { message: fallback });
    responseFor = async () => { throw new TypeError("Falha de rede"); };
    await assert.rejects(fetchJson<Cases>("/channel", fallback), { message: "Falha de rede" });
    responseFor = async () => Response.json([]);
    const abortController = new AbortController();
    assert.deepEqual(await fetchJson<Cases>("/channel", fallback, { signal: abortController.signal }), []);
    assert.equal(observedSignal, abortController.signal, "TanStack cancellation must reach the request");

    assert.equal(currentQueryData({ data: initial, isError: false, isPending: true }), undefined);
    assert.equal(currentQueryData({ data: initial, isError: false, isPlaceholderData: true }), undefined);
    assert.equal(canExportQuery({ data: undefined, isError: false, isFetching: false }), false);

    // Exercise TanStack's real behavior: failed refetches retain data in cache.
    // The display/export helpers must suppress that cache until a successful retry.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const channel = new QueryObserver<Cases>(client, {
      queryKey: ["current-channel"],
      queryFn: ({ signal }) => fetchJson<Cases>("/current", fallback, { signal }),
      enabled: false,
    });
    const comparison = new QueryObserver<Cases>(client, {
      queryKey: ["previous-channel"],
      queryFn: ({ signal }) => fetchJson<Cases>("/previous", fallback, { signal }),
      enabled: false,
    });
    const stopChannel = channel.subscribe(() => {});
    const stopComparison = comparison.subscribe(() => {});
    try {
      assert.equal(currentQueryData(channel.getCurrentResult()), undefined);
      responseFor = async () => Response.json(initial);
      await channel.refetch();
      await comparison.refetch();
      assert.deepEqual(currentQueryData(channel.getCurrentResult()), initial);
      assert.equal(canExportQuery(channel.getCurrentResult()), true);

      let rejectUpdate: (error: Error) => void = () => { throw new Error("Missing request"); };
      responseFor = () => new Promise<Response>((_resolve, reject) => { rejectUpdate = reject; });
      const comparisonUpdate = comparison.refetch();
      assert.equal(comparison.getCurrentResult().isFetching, true);
      assert.equal(canExportQuery(comparison.getCurrentResult()), false, "Export is disabled during updates");
      rejectUpdate(new TypeError("Conexão interrompida"));
      await comparisonUpdate;
      assert.equal(comparison.getCurrentResult().isError, true);
      assert.deepEqual(comparison.getCurrentResult().data, initial, "TanStack retains stale cache after a network failure");
      assert.equal(currentQueryData(comparison.getCurrentResult()), undefined, "The old comparison must not become the current line");
      assert.equal(canExportQuery(comparison.getCurrentResult()), false);
      assert.deepEqual(currentQueryData(channel.getCurrentResult()), initial, "Comparison failure must leave the valid main channel available");
      assert.equal(canExportQuery(channel.getCurrentResult()), true);

      responseFor = async () => Response.json({ error: "Base indisponível" }, { status: 503 });
      await channel.refetch();
      assert.equal(channel.getCurrentResult().isError, true);
      assert.deepEqual(channel.getCurrentResult().data, initial);
      assert.equal(currentQueryData(channel.getCurrentResult()), undefined, "HTTP failure must hide a previously evaluated channel");
      assert.equal(canExportQuery(channel.getCurrentResult()), false);

      responseFor = async () => Response.json(updated);
      await channel.refetch();
      await comparison.refetch();
      assert.equal(channel.getCurrentResult().isError, false);
      assert.deepEqual(currentQueryData(channel.getCurrentResult()), updated);
      assert.deepEqual(currentQueryData(comparison.getCurrentResult()), updated);
      assert.equal(canExportQuery(channel.getCurrentResult()), true, "A successful retry restores display and export");

      type Consultation = { total: number; querySignature: string };
      let completeConsultation: (value: { total: number }) => void = () => { throw new Error("Missing consultation"); };
      let failConsultation: (error: Error) => void = () => { throw new Error("Missing consultation"); };
      let markConsultationStarted: () => void = () => {};
      const waitForConsultationStart = () => new Promise<void>((resolve) => { markConsultationStarted = resolve; });
      const consultation = new MutationObserver<Consultation, Error, { signature: string }>(client, {
        mutationFn: async ({ signature }) => {
          const result = await new Promise<{ total: number }>((resolve, reject) => {
            completeConsultation = resolve;
            failConsultation = reject;
            markConsultationStarted();
          });
          return { ...result, querySignature: signature };
        },
      });
      const stopConsultation = consultation.subscribe(() => {});
      try {
        let activeSignature = "pergunta A|ano=2024";
        const firstStarted = waitForConsultationStart();
        const firstConsultation = consultation.mutate({ signature: activeSignature });
        assert.equal(consultation.getCurrentResult().isPending, true);
        assert.equal(currentConsultationData(consultation.getCurrentResult(), activeSignature), undefined);
        await firstStarted;
        activeSignature = "pergunta B|ano=2025";
        completeConsultation({ total: 12 });
        await firstConsultation;
        assert.equal(consultation.getCurrentResult().isSuccess, true);
        assert.equal(consultation.getCurrentResult().data?.total, 12);
        assert.equal(currentConsultationData(consultation.getCurrentResult(), activeSignature), undefined, "A late answer must not describe the newly selected question/filter");

        const freshStarted = waitForConsultationStart();
        const freshConsultation = consultation.mutate({ signature: activeSignature });
        assert.equal(currentConsultationData(consultation.getCurrentResult(), activeSignature), undefined);
        await freshStarted;
        completeConsultation({ total: 20 });
        await freshConsultation;
        assert.deepEqual(currentConsultationData(consultation.getCurrentResult(), activeSignature), { total: 20, querySignature: activeSignature });

        const failedStarted = waitForConsultationStart();
        const failedConsultation = consultation.mutate({ signature: activeSignature });
        await failedStarted;
        failConsultation(new Error("Consulta interrompida"));
        await assert.rejects(failedConsultation, { message: "Consulta interrompida" });
        assert.equal(consultation.getCurrentResult().isError, true);
        assert.equal(currentConsultationData(consultation.getCurrentResult(), activeSignature), undefined);
      } finally {
        stopConsultation();
      }
    } finally {
      stopChannel();
      stopComparison();
      client.clear();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log("Query transport, refetch cache, comparison isolation, late consultation and retry tests passed");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
