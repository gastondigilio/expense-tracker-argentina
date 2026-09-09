import type { Expense, Motivo } from "@/lib/supabase";

const MOTIVO_LABELS: Record<Motivo, string> = {
  materiales: "Materiales",
  mano_de_obra: "Mano de obra",
  pago: "Pago",
  recoleccion: "Recolección",
};

function excelDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function downloadFilteredExpensesExcel(
  rows: Expense[],
  filterLabel: string | null,
) {
  const XLSX = await import("xlsx");
  const totalArs = rows.reduce((sum, row) => sum + row.amountArs, 0);
  const totalUsd = rows.reduce((sum, row) => {
    if (!row.usdRate) return sum;
    return sum + row.amountArs / row.usdRate;
  }, 0);

  const header = ["Día", "Gasto", "Motivo", "Monto (ARS)", "Cotización BNA", "USD"];
  const body = rows.map((row) => [
    excelDate(row.date),
    row.description,
    MOTIVO_LABELS[row.motivo] ?? row.motivo,
    round2(row.amountArs),
    row.usdRate ? round2(row.usdRate) : "",
    row.usdRate ? round2(row.amountArs / row.usdRate) : "",
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([
    ["Gastos"],
    ["Filtro", filterLabel ?? "Todos"],
    [],
    header,
    ...body,
    [],
    ["", "", "TOTAL", round2(totalArs), "", round2(totalUsd)],
  ]);
  sheet["!cols"] = [
    { wch: 14 },
    { wch: 36 },
    { wch: 16 },
    { wch: 14 },
    { wch: 16 },
    { wch: 12 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Gastos");

  const slug = slugify(filterLabel ?? "todos") || "todos";
  const today = excelDate(new Date().toISOString().slice(0, 10)).replace(/\//g, "-");
  XLSX.writeFile(workbook, `gastos-${slug}-${today}.xlsx`);
}
