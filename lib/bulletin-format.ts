/**
 * Monta o texto do boletim a partir do resumo de dados (sem IA).
 *
 * O resumo usa linhas "━━━ TÍTULO ━━━" para separar seções; elas viram títulos em
 * Markdown e as demais linhas viram itens, preservando a ordem e os números.
 */
export function summaryToMarkdown(summary: string): string {
  const lines = summary.split("\n").map((line) => line.trimEnd());
  const out: string[] = [];
  let first = true;

  for (const line of lines) {
    const section = line.match(/^━+\s*(.+?)\s*━+$/);
    if (section) {
      out.push("", `## ${section[1]}`, "");
      continue;
    }
    if (!line.trim()) continue;
    if (first) {
      out.push(`**${line.trim()}**`, "");
      first = false;
      continue;
    }
    out.push(`- ${line.trim()}`);
  }

  out.push(
    "",
    "---",
    "",
    "_Boletim gerado automaticamente a partir dos dados notificados. Os números podem mudar com a entrada de notificações atrasadas e com correções na base._"
  );
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
