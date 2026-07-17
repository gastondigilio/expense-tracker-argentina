import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

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

type Expense = {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amountArs: number;
  usdRate?: number; // ARS per USD (blue venta)
  rateStatus: "pending" | "ok" | "error";
};

const STORAGE_KEY = "gastos.v1";

function loadExpenses(): Expense[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Expense[];
  } catch {
    return [];
  }
}

function saveExpenses(list: Expense[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
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

function GastosPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadRateCache();
    setExpenses(loadExpenses());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveExpenses(expenses);
  }, [expenses, loaded]);

  // Resolve pending rates
  useEffect(() => {
    const pending = expenses.filter((e) => e.rateStatus === "pending");
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const exp of pending) {
        const rate = await fetchBlueRate(exp.date);
        if (cancelled) return;
        setExpenses((prev) =>
          prev.map((e) =>
            e.id === exp.id
              ? { ...e, usdRate: rate ?? undefined, rateStatus: rate ? "ok" : "error" }
              : e,
          ),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expenses]);

  const sorted = useMemo(
    () => [...expenses].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [expenses],
  );

  const totals = useMemo(() => {
    let ars = 0;
    let usd = 0;
    let usdMissing = false;
    for (const e of expenses) {
      ars += e.amountArs;
      if (e.usdRate) usd += e.amountArs / e.usdRate;
      else usdMissing = true;
    }
    return { ars, usd, usdMissing, count: expenses.length };
  }, [expenses]);

  function addExpense(e: React.FormEvent) {
    e.preventDefault();
    const amountNum = Number(amount.replace(",", "."));
    if (!description.trim() || !amountNum || amountNum <= 0 || !date) return;
    const newExp: Expense = {
      id: crypto.randomUUID(),
      date,
      description: description.trim().slice(0, 120),
      amountArs: amountNum,
      rateStatus: "pending",
    };
    setExpenses((prev) => [newExp, ...prev]);
    setDescription("");
    setAmount("");
  }

  function removeExpense(id: string) {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }

  function retryRate(id: string) {
    setExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, rateStatus: "pending" } : e)));
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
          <SummaryCard label="Total en pesos" value={formatArs(totals.ars)} accent="primary" />
          <SummaryCard
            label="Total en dólares"
            value={formatUsd(totals.usd)}
            hint={totals.usdMissing ? "Algunas cotizaciones aún no cargaron" : undefined}
            accent="accent"
          />
          <SummaryCard label="Movimientos" value={String(totals.count)} accent="muted" />
        </section>

        {/* Form */}
        <section className="glass-card mb-8 rounded-2xl p-5 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">Cargar gasto</h2>
          <form onSubmit={addExpense} className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="sm:col-span-3">
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
            <div className="sm:col-span-5">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Gasto</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ej: Supermercado, alquiler, Netflix…"
                maxLength={120}
                required
                className="w-full rounded-lg border border-border bg-input/60 px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
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
            <div className="sm:col-span-2 flex items-end">
              <button type="submit" className="btn-primary w-full rounded-lg px-4 py-2.5 text-sm">
                Agregar
              </button>
            </div>
          </form>
        </section>

        {/* Table */}
        <section className="glass-card overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <h2 className="text-lg font-semibold">Historial</h2>
            <span className="text-xs text-muted-foreground">
              {expenses.length} {expenses.length === 1 ? "gasto" : "gastos"}
            </span>
          </div>

          {sorted.length === 0 ? (
            <div className="px-5 py-16 text-center text-sm text-muted-foreground">
              Todavía no cargaste ningún gasto. Empezá agregando uno arriba.
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
                      <th className="px-5 py-3 font-medium text-right">Monto (ARS)</th>
                      <th className="px-5 py-3 font-medium text-right">Cotización</th>
                      <th className="px-5 py-3 font-medium text-right">USD</th>
                      <th className="px-5 py-3 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((e) => (
                      <tr key={e.id} className="row-hover border-t border-border/40">
                        <td className="px-5 py-3.5 whitespace-nowrap text-muted-foreground">
                          {formatDate(e.date)}
                        </td>
                        <td className="px-5 py-3.5 font-medium">{e.description}</td>
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
                          <button
                            onClick={() => removeExpense(e.id)}
                            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                            aria-label="Eliminar"
                          >
                            <TrashIcon />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="sm:hidden divide-y divide-border/40">
                {sorted.map((e) => (
                  <li key={e.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">{formatDate(e.date)}</div>
                        <div className="mt-0.5 truncate font-medium">{e.description}</div>
                      </div>
                      <button
                        onClick={() => removeExpense(e.id)}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Eliminar"
                      >
                        <TrashIcon />
                      </button>
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
            </>
          )}
        </section>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Cotizaciones del dólar blue vía dolarapi.com y argentinadatos.com. Datos guardados localmente en tu navegador.
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

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}
