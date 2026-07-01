/**
 * Exporta o primeiro SVG encontrado dentro de um elemento HTML como arquivo PNG.
 * Funciona com gráficos Recharts que renderizam SVG inline.
 */
export function exportChartSvg(container: HTMLElement | null, filename = "grafico") {
  if (!container) return;
  const svg = container.querySelector("svg");
  if (!svg) return;

  const bbox = svg.getBoundingClientRect();
  const w = Math.max(bbox.width, 400);
  const h = Math.max(bbox.height, 200);
  const scale = 2;

  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  // Serializa o SVG com dimensões explícitas
  // Usa base64 data URL em vez de createObjectURL para compatibilidade com Safari
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  const serialized = new XMLSerializer().serializeToString(clone);
  const base64 = btoa(unescape(encodeURIComponent(serialized)));
  const url = `data:image/svg+xml;base64,${base64}`;

  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0);
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${filename}.png`;
    link.click();
  };
  img.src = url;
}
