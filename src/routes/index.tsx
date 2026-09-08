import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fromDb,
  isMotivo,
  supabase,
  toDb,
  type Expense,
  type Motivo,
} from "@/lib/supabase";

const selectTriggerClass =
  "h-auto w-full rounded-lg border border-border bg-input/60 px-3 py-2.5 text-sm text-foreground shadow-none outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30 focus:ring-offset-0 data-[placeholder]:text-muted-foreground/60";

const selectContentClass =
  "rounded-lg border border-border bg-input text-foreground shadow-lg";

const selectItemClass =
  "cursor-pointer rounded-md py-2 focus:bg-muted focus:text-foreground";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gastos — Registro personal con conversión a USD" },
      {
        name: "description",
        content:
          "Registrá tus gastos diarios en pesos y visualizá automáticamente su equivalente en dólares al valor del blue de ese día.",
      },
      { property: "og:title", content: "Gastos — Registro personal con conversión a USD" },
      {
        property: "og:description",
        content:
          "Registrá tus gastos diarios en pesos y visualizá automáticamente su equivalente en dólares al valor del blue de ese día.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  component: GastosPage,
});

const MOTIVO_OPTIONS: { value: Motivo; label: string }[] = [
  { value: "materiales", label: "Materiales" },
  { value: "mano_de_obra", label: "Mano de obra" },
  { value: "pago", label: "Pago" },
  { value: "recoleccion", label: "Recolección" },
];

const MOTIVO_LABELS: Record<Motivo, string> = {
  materiales: "Materiales",
  mano_de_obra: "Mano de obra",
  pago: "Pago",
  recoleccion: "Recolección",
};

const STORAGE_KEY = "gastos.v1";

function normalizeMotivo(value: unknown): Motivo {
  return isMotivo(value) ? value : "materiales";
}

function loadLocalExpenses(): Expense[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Expense[];
    return list.map((e) => ({ ...e, motivo: normalizeMotivo(e.motivo) }));
  } catch {
    return [];
  }
}

// Cache rates in memory + localStorage to avoid re-fetching
const rateCache = new Map<string, number>();
function loadRateCache() {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem("gastos.rates");
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, number>;
    Object.entries(obj).forEach(([k, v]) => rateCache.set(k, v));
  } catch {}
}
function persistRateCache() {
  const obj: Record<string, number> = {};
  rateCache.forEach((v, k) => (obj[k] = v));
  localStorage.setItem("gastos.rates", JSON.stringify(obj));
}

async function fetchBlueRate(date: string): Promise<number | null> {
  if (rateCache.has(date)) return rateCache.get(date)!;
  const [y, m, d] = date.split("-");
  const today = new Date().toISOString().slice(0, 10);
  try {
    let url: string;
    if (date >= today) {
      url = "https://dolarapi.com/v1/dolares/blue";
    } else {
      url = `https://api.argentinadatos.com/v1/cotizaciones/dolares/blue/${y}/${m}/${d}`;
    }
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const rate = Number(data.venta ?? data.compra);
    if (!rate || Number.isNaN(rate)) return null;
    rateCache.set(date, rate);
    persistRateCache();
    return rate;
  } catch {
    return null;
  }
}

function formatArs(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
}
function formatUsd(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

const PAGE_SIZE = 15;

function GastosPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [motivo, setMotivo] = useState<Motivo>("materiales");
  const [amount, setAmount] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterGasto, setFilterGasto] = useState("");
  const [filterMotivo, setFilterMotivo] = useState<"all" | Motivo>("all");
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRateCache();
    let cancelled = false;
    (async () => {
      const { data, error: loadError } = await supabase
        .from("expenses")
        .select("*")
        .order("date", { ascending: false })
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (loadError) {
        setError("No se pudieron cargar los gastos desde la base.");
        setLoaded(true);
        return;
      }

      let list = (data ?? []).map(fromDb);

      if (list.length === 0) {
        const local = loadLocalExpenses();
        if (local.length > 0) {
          const { error: migrateError } = await supabase.from("expenses").insert(local.map(toDb));
          if (!migrateError) {
            list = local;
            localStorage.removeItem(STORAGE_KEY);
          }
        }
      }

      if (cancelled) return;
      setExpenses(list);
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve pending rates
  useEffect(() => {
    if (!loaded) return;
    const pending = expenses.filter((e) => e.rateStatus === "pending");
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const exp of pending) {
        const rate = await fetchBlueRate(exp.date);
        if (cancelled) return;
        const rateStatus = rate ? "ok" : "error";
        const { error: updateError } = await supabase
          .from("expenses")
          .update({ usd_rate: rate, rate_status: rateStatus })
          .eq("id", exp.id);
        if (cancelled || updateError) return;
        setExpenses((prev) =>
          prev.map((e) =>
            e.id === exp.id ? { ...e, usdRate: rate ?? undefined, rateStatus } : e,
          ),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expenses, loaded]);

  const sorted = useMemo(
    () => [...expenses].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [expenses],
  );

  const filtered = useMemo(() => {
    const query = filterGasto.trim().toLowerCase();
    return sorted.filter((e) => {
      const matchesGasto = !query || e.description.toLowerCase().includes(query);
      const matchesMotivo =
        filterMotivo === "all" || normalizeMotivo(e.motivo) === filterMotivo;
      return matchesGasto && matchesMotivo;
    });
  }, [sorted, filterGasto, filterMotivo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const paginated = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  useEffect(() => {
    setPage(1);
  }, [filterGasto, filterMotivo]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const hasActiveFilter = Boolean(filterGasto.trim()) || filterMotivo !== "all";

  const totals = useMemo(() => {
    let ars = 0;
    let usd = 0;
    let usdMissing = false;
    for (const e of filtered) {
      ars += e.amountArs;
      if (e.usdRate) usd += e.amountArs / e.usdRate;
      else usdMissing = true;
    }
    return { ars, usd, usdMissing, count: filtered.length };
  }, [filtered]);

  const totalsLabel = useMemo(() => {
    if (filterMotivo !== "all" && filterGasto.trim()) {
      return `${MOTIVO_LABELS[filterMotivo]} · “${filterGasto.trim()}”`;
    }
    if (filterMotivo !== "all") return MOTIVO_LABELS[filterMotivo];
    if (filterGasto.trim()) return `“${filterGasto.trim()}”`;
    return null;
  }, [filterGasto, filterMotivo]);

  function resetForm() {
    setDescription("");
    setMotivo("materiales");
    setAmount("");
    setEditingId(null);
    setDate(new Date().toISOString().slice(0, 10));
  }

  function startEdit(expense: Expense) {
    setEditingId(expense.id);
    setDate(expense.date);
    setDescription(expense.description);
    setMotivo(normalizeMotivo(expense.motivo));
    setAmount(String(expense.amountArs));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveExpense(e: React.FormEvent) {
    e.preventDefault();
    const amountNum = Number(amount.replace(",", "."));
    if (!description.trim() || !amountNum || amountNum <= 0 || !date || saving) return;

    const trimmedDescription = description.trim().slice(0, 120);
    setSaving(true);
    setError(null);

    try {
      if (editingId) {
        const current = expenses.find((exp) => exp.id === editingId);
        if (!current) return;
        const dateChanged = current.date !== date;
        const payload = {
          date,
          description: trimmedDescription,
          motivo,
          amount_ars: amountNum,
          ...(dateChanged ? { usd_rate: null, rate_status: "pending" as const } : {}),
        };
        const { data, error: updateError } = await supabase
          .from("expenses")
          .update(payload)
          .eq("id", editingId)
          .select()
          .single();
        if (updateError) throw updateError;
        setExpenses((prev) => prev.map((exp) => (exp.id === editingId ? fromDb(data) : exp)));
        resetForm();
        return;
      }

      const { data, error: insertError } = await supabase
        .from("expenses")
        .insert({
          date,
          description: trimmedDescription,
          motivo,
          amount_ars: amountNum,
          rate_status: "pending",
        })
        .select()
        .single();
      if (insertError) throw insertError;
      setExpenses((prev) => [fromDb(data), ...prev]);
      setDescription("");
      setMotivo("materiales");
      setAmount("");
    } catch {
      setError("No se pudo guardar el gasto en la base.");
    } finally {
      setSaving(false);
    }
  }

  async function removeExpense(id: string) {
    const { error: deleteError } = await supabase.from("expenses").delete().eq("id", id);
    if (deleteError) {
      setError("No se pudo eliminar el gasto.");
      return;
    }
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    if (editingId === id) resetForm();
  }

  async function retryRate(id: string) {
    const { error: updateError } = await supabase
      .from("expenses")
      .update({ rate_status: "pending", usd_rate: null })
      .eq("id", id);
    if (updateError) {
      setError("No se pudo reintentar la cotización.");
      return;
    }
    setExpenses((prev) =>
      prev.map((e) => (e.id === id ? { ...e, rateStatus: "pending", usdRate: undefined } : e)),
    );
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:py-16">
        {/* Header */}
        <header className="mb-10 sm:mb-14">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            Cotización blue en tiempo real · Argentina
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Mis <span className="text-gradient">gastos</span>
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Registrá cada gasto en pesos y automáticamente calculamos su equivalente en dólares al valor del blue de ese día.
          </p>
        </header>

        {/* Summary cards */}
        <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard
            label={hasActiveFilter ? "Total filtrado (ARS)" : "Total en pesos"}
            value={formatArs(totals.ars)}
            hint={totalsLabel ?? undefined}
            accent="primary"
          />
          <SummaryCard
            label={hasActiveFilter ? "Total filtrado (USD)" : "Total en dólares"}
            value={formatUsd(totals.usd)}
            hint={
              totals.usdMissing
                ? "Algunas cotizaciones aún no cargaron"
                : (totalsLabel ?? undefined)
            }
            accent="accent"
          />
          <SummaryCard
            label={hasActiveFilter ? "Movimientos filtrados" : "Movimientos"}
            value={String(totals.count)}
            hint={hasActiveFilter ? `de ${expenses.length} totales` : undefined}
            accent="muted"
          />
        </section>

        {/* Form */}
        <section className="glass-card mb-8 rounded-2xl p-5 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">
            {editingId ? "Editar gasto" : "Cargar gasto"}
          </h2>
          {error && (
            <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <form onSubmit={saveExpense} className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Día</label>
              <input
                type="date"
                value={date}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full rounded-lg border border-border bg-input/60 px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Gasto</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ej: Cemento, plomero…"
                maxLength={120}
                required
                className="w-full rounded-lg border border-border bg-input/60 px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Motivo</label>
              <Select value={motivo} onValueChange={(value) => setMotivo(value as Motivo)}>
                <SelectTrigger className={selectTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={selectContentClass}>
                  {MOTIVO_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className={selectItemClass}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Monto (ARS)</label>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                required
                className="w-full rounded-lg border border-border bg-input/60 px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/30 font-mono"
              />
            </div>
            <div
              className={`flex items-end gap-2 ${editingId ? "sm:col-span-12 sm:justify-end" : "sm:col-span-2"}`}
            >
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  Cancelar
                </button>
              )}
              <button
                type="submit"
                disabled={saving || !loaded}
                className={`btn-primary rounded-lg px-4 py-2.5 text-sm ${editingId ? "min-w-28" : "w-full"} disabled:opacity-60`}
              >
                {saving ? "Guardando…" : editingId ? "Guardar" : "Agregar"}
              </button>
            </div>
          </form>
        </section>

        {/* Table */}
        <section className="glass-card overflow-hidden rounded-2xl">
          <div className="border-b border-border/60 px-5 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center justify-between gap-3 sm:justify-start">
                <h2 className="text-lg font-semibold">Historial</h2>
                <span className="text-xs text-muted-foreground">
                  {filtered.length} de {expenses.length}{" "}
                  {expenses.length === 1 ? "gasto" : "gastos"}
                </span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:w-auto">
                <button
                  type="button"
                  onClick={() => {
                    setFilterGasto("");
                    setFilterMotivo("all");
                  }}
                  disabled={!hasActiveFilter}
                  className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Borrar filtros"
                >
                  Borrar filtros
                </button>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:min-w-[28rem]">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Filtrar por gasto
                    </label>
                    <input
                      type="search"
                      value={filterGasto}
                      onChange={(e) => setFilterGasto(e.target.value)}
                      placeholder="Buscar descripción…"
                      className="w-full rounded-lg border border-border bg-input/60 px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Filtrar por motivo
                    </label>
                    <Select
                      value={filterMotivo}
                      onValueChange={(value) => setFilterMotivo(value as "all" | Motivo)}
                    >
                      <SelectTrigger className={`${selectTriggerClass} py-2`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className={selectContentClass}>
                        <SelectItem value="all" className={selectItemClass}>
                          Todos
                        </SelectItem>
                        {MOTIVO_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} className={selectItemClass}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {expenses.length === 0 ? (
            <div className="px-5 py-16 text-center text-sm text-muted-foreground">
              Todavía no cargaste ningún gasto. Empezá agregando uno arriba.
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-16 text-center text-sm text-muted-foreground">
              No hay gastos que coincidan con el filtro.
            </div>
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-5 py-3 font-medium">Día</th>
                      <th className="px-5 py-3 font-medium">Gasto</th>
                      <th className="px-5 py-3 font-medium">Motivo</th>
                      <th className="px-5 py-3 font-medium text-right">Monto (ARS)</th>
                      <th className="px-5 py-3 font-medium text-right">Cotización</th>
                      <th className="px-5 py-3 font-medium text-right">USD</th>
                      <th className="px-5 py-3 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((e) => (
                      <tr key={e.id} className="row-hover border-t border-border/40">
                        <td className="px-5 py-3.5 whitespace-nowrap text-muted-foreground">
                          {formatDate(e.date)}
                        </td>
                        <td className="px-5 py-3.5 font-medium">{e.description}</td>
                        <td className="px-5 py-3.5 text-muted-foreground">
                          {MOTIVO_LABELS[normalizeMotivo(e.motivo)]}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono">{formatArs(e.amountArs)}</td>
                        <td className="px-5 py-3.5 text-right font-mono text-xs text-muted-foreground">
                          {e.rateStatus === "ok" && e.usdRate
                            ? `$${e.usdRate.toFixed(2)}`
                            : e.rateStatus === "pending"
                              ? "…"
                              : "—"}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono">
                          {e.rateStatus === "ok" && e.usdRate ? (
                            <span className="text-success">{formatUsd(e.amountArs / e.usdRate)}</span>
                          ) : e.rateStatus === "pending" ? (
                            <span className="inline-block h-3 w-14 animate-pulse rounded bg-muted" />
                          ) : (
                            <button
                              onClick={() => retryRate(e.id)}
                              className="text-xs text-warning hover:underline"
                            >
                              Reintentar
                            </button>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="inline-flex items-center gap-0.5">
                            <button
                              onClick={() => startEdit(e)}
                              className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                              aria-label="Editar"
                            >
                              <PencilIcon />
                            </button>
                            <button
                              onClick={() => removeExpense(e.id)}
                              className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                              aria-label="Eliminar"
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="sm:hidden divide-y divide-border/40">
                {paginated.map((e) => (
                  <li key={e.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">{formatDate(e.date)}</div>
                        <div className="mt-0.5 truncate font-medium">{e.description}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {MOTIVO_LABELS[normalizeMotivo(e.motivo)]}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          onClick={() => startEdit(e)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label="Editar"
                        >
                          <PencilIcon />
                        </button>
                        <button
                          onClick={() => removeExpense(e.id)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Eliminar"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="font-mono text-sm">{formatArs(e.amountArs)}</span>
                      {e.rateStatus === "ok" && e.usdRate ? (
                        <span className="font-mono text-sm text-success">
                          {formatUsd(e.amountArs / e.usdRate)}
                        </span>
                      ) : e.rateStatus === "pending" ? (
                        <span className="h-3 w-16 animate-pulse rounded bg-muted" />
                      ) : (
                        <button onClick={() => retryRate(e.id)} className="text-xs text-warning">
                          Reintentar
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
                  <span className="text-xs text-muted-foreground">
                    Página {currentPage} de {totalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage <= 1}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage >= totalPages}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Cotizaciones del dólar blue vía dolarapi.com y argentinadatos.com. Los gastos se guardan en tu base de Supabase.
        </p>
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent: "primary" | "accent" | "muted";
}) {
  const accentClass =
    accent === "primary"
      ? "from-primary/25 to-transparent"
      : accent === "accent"
        ? "from-accent/25 to-transparent"
        : "from-muted/40 to-transparent";
  return (
    <div className="glass-card relative overflow-hidden rounded-2xl p-5">
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${accentClass}`} />
      <div className="relative">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-2 font-display text-2xl font-semibold sm:text-3xl">{value}</div>
        {hint && <div className="mt-1 text-xs text-warning">{hint}</div>}
      </div>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}
