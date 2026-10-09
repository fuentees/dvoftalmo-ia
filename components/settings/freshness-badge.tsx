/** Selo de atualização: quantos dias desde a última importação da fonte. */
export function FreshnessBadge({ lastSync, hasData }: { lastSync: string | null | undefined; hasData: boolean | undefined }) {
  if (hasData === undefined) return null;
  if (!hasData || !lastSync) {
    return <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Sem dados</span>;
  }
  const time = new Date(lastSync).getTime();
  if (Number.isNaN(time)) return null;
  const days = Math.floor((Date.now() - time) / 86_400_000);
  const label = days <= 0 ? "Atualizado hoje" : days === 1 ? "1 dia sem atualizar" : `${days} dias sem atualizar`;
  const tone = days <= 7 ? "bg-teal-100 text-teal-800" : days <= 30 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";
  return <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>;
}
