"use client";
import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  LineChartSkeleton,
  MultiLineChart,
} from "@/components/ui/chart";
import { supabase } from "@/lib/supabase";

export function WalletView({ address }: { address: string }) {
  const [period, setPeriod] = useState<"30D" | "365D">("30D");
  const [tab, setTab] = useState<"overview" | "history">("overview");
  const [history, setHistory] = useState<
    Array<{
      date: string;
      event: string;
      amount: number;
      exchange?: string | null;
      notes?: string | null;
      sub_account?: string | null;
    }>
  >([]);
  const [historyPage, setHistoryPage] = useState(1);
  const pageSize = 25;
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Overview aggregates
  const [totalDeposits, setTotalDeposits] = useState<number | null>(null);
  const [apr7d, setApr7d] = useState<number | null>(null);

  // Prefetch overview aggregates (sum deposits - withdrawals) from account_history
  useEffect(() => {
    let cancelled = false;
    async function loadAggregates() {
      try {
        if (!address || !address.trim()) return;
        const { data, error } = await supabase
          .from("account_history")
          .select("event,amount")
          .ilike("account", address);
        if (!cancelled) {
          if (!error && Array.isArray(data)) {
            let deposits = 0;
            let withdrawals = 0;
            for (const r of data as any[]) {
              const evt = String(r.event ?? "").toLowerCase();
              const amt = Number(r.amount) || 0;
              if (evt === "deposit") deposits += amt;
              else if (evt === "withdrawal") withdrawals += amt;
            }
            setTotalDeposits(deposits - withdrawals);
          } else {
            setTotalDeposits(0);
          }
        }
      } catch {
        if (!cancelled) setTotalDeposits(0);
      }
    }
    loadAggregates();
    return () => {
      cancelled = true;
    };
  }, [address]);

  // History fetch from account_history
  useEffect(() => {
    if (tab !== "history") return;
    let cancelled = false;
    async function loadHistory() {
      if (!address || !address.trim()) return;
      const from = (historyPage - 1) * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from("account_history")
        .select("date, event, amount, exchange, notes, sub_account")
        .ilike("account", address)
        .order("date", { ascending: false })
        .range(from, to);
      if (!cancelled) {
        if (!error && data) {
          setHistoryError(null);
          setHistory(
            (data as any[]).map((r: any) => ({
              date: r.date,
              event: String(r.event ?? "").toLowerCase(),
              amount: Number(r.amount),
              exchange: r.exchange ?? null,
              notes: r.notes ?? null,
              sub_account: r.sub_account ?? null,
            }))
          );
        } else {
          setHistory([]);
          setHistoryError(error?.message ?? "No entries");
          if (error) console.error("Supabase history error", error);
        }
      }
    }
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [tab, address, historyPage]);

  // Value series fetch from account_value
  const [valueSeries, setValueSeries] = useState<Array<[number, number]>>([]);
  const [depositSeries, setDepositSeries] = useState<Array<[number, number]>>(
    []
  );
  const currentValue = useMemo(() => {
    if (valueSeries.length === 0) return undefined;
    return valueSeries[valueSeries.length - 1][1];
  }, [valueSeries]);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      try {
        if (!address || !address.trim()) return;
        const now = new Date();
        const cutoff = new Date(now);
        if (period === "30D") cutoff.setDate(now.getDate() - 30);
        else cutoff.setDate(now.getDate() - 365);
        const cutoffStr = cutoff.toISOString().slice(0, 10);

        // Load values first
        const valsRes = await supabase
          .from("account_value")
          .select("date_time, amount")
          .ilike("account", address)
          .gte("date_time", cutoffStr)
          .order("date_time", { ascending: true });
        if (cancelled) return;

        let seriesVals: Array<[number, number]> = [];
        if (!valsRes.error && Array.isArray(valsRes.data)) {
          seriesVals = (valsRes.data as any[])
            .map((r: any) => [
              Math.floor(new Date(r.date_time).getTime() / 1000),
              Number(r.amount) || 0,
            ])
            .filter(
              (p): p is [number, number] =>
                Array.isArray(p) &&
                Number.isFinite(p[0]) &&
                Number.isFinite(p[1])
            )
            .sort((a, b) => a[0] - b[0]);
        }

        // Then load ALL history up to the last value date to avoid missing pre-window flows
        let seriesDeps: Array<[number, number]> = [];
        if (seriesVals.length > 0) {
          const lastStr = new Date(seriesVals[seriesVals.length - 1][0] * 1000)
            .toISOString()
            .slice(0, 10);
          const histRes = await supabase
            .from("account_history")
            .select("date, event, amount")
            .ilike("account", address)
            .lte("date", lastStr)
            .order("date", { ascending: true });
          if (!cancelled && !histRes.error && Array.isArray(histRes.data)) {
            const events = (histRes.data as any[])
              .map((r: any) => {
                const dateStr: string = r.date;
                const amtRaw = Number(r.amount) || 0;
                const evt = String(r.event ?? "")
                  .trim()
                  .toLowerCase();
                const sign = evt === "withdrawal" ? -1 : 1;
                return {
                  dateStr,
                  ts: Math.floor(new Date(r.date).getTime() / 1000),
                  amt: sign * amtRaw,
                  isDeposit: sign > 0,
                };
              })
              .sort((a, b) => a.dateStr.localeCompare(b.dateStr));

            const byWeek = new Map<string, number>();
            for (const e of events) {
              const endStr = weekEndingSunday(e.dateStr);
              byWeek.set(endStr, (byWeek.get(endStr) || 0) + e.amt);
            }
            // initial cumulative from weeks strictly before the first visible value week
            const firstStr = new Date(seriesVals[0][0] * 1000)
              .toISOString()
              .slice(0, 10);
            let cum = 0;
            for (const [week, amt] of byWeek.entries()) {
              if (week < firstStr) cum += amt || 0;
            }
            // step through aligned value timestamps and add that week's flow
            for (const [ts] of seriesVals) {
              const dStr = new Date(ts * 1000).toISOString().slice(0, 10);
              cum += byWeek.get(dStr) || 0;
              seriesDeps.push([ts, cum]);
            }

            // If first deposit in window precedes first value point, prepend
            const firstDep = events.find(
              (e) => e.isDeposit && e.dateStr >= cutoffStr
            );
            if (
              firstDep &&
              (seriesVals.length === 0 || firstDep.ts < seriesVals[0][0])
            ) {
              let cumAtOrigin = 0;
              for (const e of events) {
                if (e.dateStr <= firstDep.dateStr) cumAtOrigin += e.amt;
              }
              seriesVals = [
                [firstDep.ts, Math.max(cumAtOrigin, 0)],
                ...seriesVals,
              ];
              seriesDeps = [[firstDep.ts, cumAtOrigin], ...seriesDeps];
            }
          }
        }

        setValueSeries(seriesVals);
        setDepositSeries(seriesDeps);
      } catch {
        if (!cancelled) {
          setValueSeries([]);
          setDepositSeries([]);
        }
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [address, period]);

  // Compute 7D APR using Modified Dietz to neutralize deposits/withdrawals
  useEffect(() => {
    let cancelled = false;
    async function computeApr() {
      try {
        if (!address || !address.trim()) return setApr7d(null);
        if (valueSeries.length === 0) {
          setApr7d(null);
          return;
        }

        const endTs = valueSeries[valueSeries.length - 1][0];
        const endValue = valueSeries[valueSeries.length - 1][1];
        const startTs = endTs - 7 * 24 * 60 * 60; // 7 days window

        // Get beginning value at startTs by picking first point on/after startTs
        // or fallback to earliest available value
        const startIdx = valueSeries.findIndex((p) => p[0] >= startTs);
        const startPoint =
          startIdx >= 0 ? valueSeries[startIdx] : valueSeries[0];
        const periodStartTs = startPoint[0];
        const startValue = startPoint[1];

        // Fetch cashflows within window [periodStartTs, endTs]
        const fromStr = new Date(periodStartTs * 1000)
          .toISOString()
          .slice(0, 10);
        const toStr = new Date(endTs * 1000).toISOString().slice(0, 10);
        const flowsRes = await supabase
          .from("account_history")
          .select("date, event, amount")
          .ilike("account", address)
          .gte("date", fromStr)
          .lte("date", toStr)
          .order("date", { ascending: true });
        if (cancelled) return;

        type Flow = { ts: number; amount: number };
        const flows: Flow[] = [];
        if (!flowsRes.error && Array.isArray(flowsRes.data)) {
          for (const r of flowsRes.data as any[]) {
            const evt = String(r.event ?? "")
              .trim()
              .toLowerCase();
            if (evt !== "deposit" && evt !== "withdrawal") continue;
            const sign = evt === "withdrawal" ? -1 : 1;
            const amt = sign * (Number(r.amount) || 0);
            const ts = Math.floor(new Date(r.date).getTime() / 1000);
            // Exclude flows exactly at the start from weighting (weight 1.0)
            if (Number.isFinite(amt) && Number.isFinite(ts)) {
              flows.push({ ts, amount: amt });
            }
          }
        }

        // Treat any flows at or before the first available value timestamp
        // as part of the beginning value measurement, not as period cashflows.
        // Therefore, exclude them from flows. Keep startValue as-is.
        const periodFlows = flows.filter((f) => f.ts > periodStartTs);

        const r = modifiedDietzReturn({
          startValue,
          endValue,
          startTs: periodStartTs,
          endTs,
          flows: periodFlows,
        });

        if (!Number.isFinite(r)) {
          setApr7d(null);
          return;
        }
        // annualize simple return over 7 days
        const apr = r * (365 / 7);
        setApr7d(apr);
      } catch {
        if (!cancelled) setApr7d(null);
      }
    }
    computeApr();
    return () => {
      cancelled = true;
    };
  }, [address, valueSeries]);

  function modifiedDietzReturn({
    startValue,
    endValue,
    startTs,
    endTs,
    flows,
  }: {
    startValue: number;
    endValue: number;
    startTs: number;
    endTs: number;
    flows: Array<{ ts: number; amount: number }>;
  }) {
    const periodLength = Math.max(1, endTs - startTs);
    let weightedFlows = 0;
    let netFlows = 0;
    for (const f of flows) {
      if (f.ts < startTs || f.ts > endTs) continue;
      const weight = 1 - (f.ts - startTs) / periodLength; // weight of capital time in period
      weightedFlows += f.amount * Math.max(0, Math.min(1, weight));
      netFlows += f.amount;
    }
    const denominator = startValue + weightedFlows;
    if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-9) {
      return NaN;
    }
    return (endValue - startValue - netFlows) / denominator;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold break-all">{address}</h1>
        <PeriodToggle value={period} onChange={setPeriod} />
      </header>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-muted-foreground"></div>
          <ChartPercent values={valueSeries} deposits={depositSeries} />
        </div>
        {valueSeries.length > 0 ? (
          <MultiLineChart values={valueSeries} deposits={depositSeries} />
        ) : (
          <LineChartSkeleton />
        )}
      </section>

      <section className="space-y-4">
        <Tabs value={tab} onChange={setTab} />
        {tab === "overview" ? (
          <OverviewCards
            currentValue={currentValue}
            totalDeposits={totalDeposits}
            apr7d={apr7d}
          />
        ) : (
          <HistoryTable
            rows={history}
            page={historyPage}
            pageSize={pageSize}
            onPrev={() => setHistoryPage((p) => Math.max(1, p - 1))}
            onNext={() => setHistoryPage((p) => p + 1)}
            error={historyError}
          />
        )}
      </section>
    </div>
  );
}

function ChartPercent({
  values,
  deposits,
}: {
  values: Array<[number, number]>;
  deposits: Array<[number, number]>;
}) {
  const pct = useMemo(() => {
    if (!values || values.length < 2) return null;
    const tsMin = values[0][0];
    const tsMax = values[values.length - 1][0];
    const startVal = values[0][1];
    const endVal = values[values.length - 1][1];
    // Find deposits at or before the first/last timestamps
    const depStart = findAtOrBefore(deposits, tsMin) ?? 0;
    const depEnd = findAtOrBefore(deposits, tsMax) ?? depStart;
    const change = computePctFromDeposits(startVal, depStart, endVal, depEnd);
    return Number.isFinite(change) ? change : null;
  }, [values, deposits]);

  return (
    <div className="text-sm font-medium">{formatPctOrDash(pct ?? null)}</div>
  );
}

function findAtOrBefore(series: Array<[number, number]>, ts: number) {
  if (!series || series.length === 0) return undefined;
  let best: [number, number] | undefined;
  for (const p of series) {
    if (p[0] <= ts) {
      if (!best || p[0] > best[0]) best = p;
    }
  }
  return best?.[1];
}

// Computes growth as the difference in growth between deposits and value
// Using deposits as the baseline (principal) and value as the portfolio value.
// Return = (endValue - endDeposits) / max(startDeposits, 1e-9) - (startValue - startDeposits)/max(startDeposits,1e-9)
// But simpler and equivalent for start-aligned comparison:
// We compare net values relative to deposit baseline: (endVal - endDep) / endDep vs (startVal - startDep) / startDep.
// To avoid instability when startDeposits is 0, fall back to change in net value if possible.
function computePctFromDeposits(
  startVal: number,
  startDep: number,
  endVal: number,
  endDep: number
) {
  // If both start and end deposits are positive, use deposit baseline
  if (startDep > 0 && endDep > 0) {
    const startNetOverDep = (startVal - startDep) / startDep;
    const endNetOverDep = (endVal - endDep) / endDep;
    return endNetOverDep - startNetOverDep;
  }
  // If only end deposits available, measure against end deposits
  if (endDep > 0) {
    return (endVal - endDep) / endDep;
  }
  // Fallback: compare net values relative to start net baseline if available
  const startNet = startVal - startDep;
  const endNet = endVal - endDep;
  if (Math.abs(startNet) > 1e-9) {
    return endNet / startNet - 1;
  }
  return NaN;
}

function weekEndingSunday(dateStr: string): string {
  // Input: YYYY-MM-DD; Output: YYYY-MM-DD of the Sunday ending that week
  const d = new Date(dateStr + "T00:00:00Z");
  // getUTCDay: 0=Sunday, 6=Saturday. We want the Sunday at/after this date.
  const day = d.getUTCDay();
  const addDays = (7 - day) % 7; // 0 if already Sunday
  d.setUTCDate(d.getUTCDate() + addDays);
  return d.toISOString().slice(0, 10);
}

function PeriodToggle({
  value,
  onChange,
}: {
  value: "30D" | "365D";
  onChange: (v: "30D" | "365D") => void;
}) {
  const options: Array<"30D" | "365D"> = ["30D", "365D"];
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border bg-card p-1">
      {options.map((label) => (
        <button
          key={label}
          onClick={() => onChange(label)}
          className={
            "px-3 py-1.5 rounded-sm text-sm transition-colors " +
            (value === label
              ? "bg-primary text-primary-foreground"
              : "hover:bg-accent hover:text-accent-foreground")
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Tabs({
  value,
  onChange,
}: {
  value: "overview" | "history";
  onChange: (v: "overview" | "history") => void;
}) {
  return (
    <div className="flex gap-2 border-b border-border">
      <button
        onClick={() => onChange("overview")}
        className={
          "px-3 py-2 text-sm -mb-px border-b-2 " +
          (value === "overview"
            ? "border-primary text-primary"
            : "border-transparent text-muted-foreground hover:text-foreground")
        }
      >
        Overview
      </button>
      <button
        onClick={() => onChange("history")}
        className={
          "px-3 py-2 text-sm -mb-px border-b-2 " +
          (value === "history"
            ? "border-primary text-primary"
            : "border-transparent text-muted-foreground hover:text-foreground")
        }
      >
        History
      </button>
    </div>
  );
}

function OverviewCards({
  currentValue,
  totalDeposits,
  apr7d,
}: {
  currentValue?: number;
  totalDeposits: number | null;
  apr7d: number | null;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <StatCard label="Total Deposits" value={formatUsd(totalDeposits ?? 0)} />
      <StatCard label="Current Value" value={formatUsd(currentValue)} />
      <StatCard label="7D Avg APR" value={formatPctOrDash(apr7d)} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function formatPct(v: number) {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(2)}%`;
}

function formatUsd(v?: number) {
  if (v === undefined || !Number.isFinite(v)) return "$—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

function formatPctOrDash(v: number | null) {
  if (v === null || !Number.isFinite(v)) return "—%";
  return formatPct(v);
}

function TestButtons({ address }: { address: string }) {
  const [out, setOut] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function testEquity() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/drift/equity?address=${encodeURIComponent(address)}`
      );
      const json = await res.json();
      setOut(JSON.stringify(json, null, 2));
    } catch (e: any) {
      setOut(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function writeSnapshot() {
    setBusy(true);
    try {
      const res = await fetch(`/api/drift/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const json = await res.json();
      setOut(JSON.stringify(json, null, 2));
    } catch (e: any) {
      setOut(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <button
          onClick={testEquity}
          disabled={busy}
          className="px-3 py-1.5 rounded border border-border hover:bg-accent"
        >
          Test Drift Equity (no DB)
        </button>
        <button
          onClick={writeSnapshot}
          disabled={busy}
          className="px-3 py-1.5 rounded border border-border hover:bg-accent"
        >
          Write Snapshot to DB
        </button>
      </div>
      {out && (
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
          {out}
        </pre>
      )}
    </div>
  );
}

function HistoryTable({
  rows,
  page,
  pageSize,
  onPrev,
  onNext,
  error,
}: {
  rows: Array<{
    date: string;
    event: string;
    amount: number;
    exchange?: string | null;
    notes?: string | null;
    sub_account?: string | null;
  }>;
  page: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
  error?: string | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Exchange</th>
              <th className="px-3 py-2">Sub-Account</th>
              <th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-6 text-center text-muted-foreground"
                  colSpan={6}
                >
                  {error ?? "No entries"}
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={idx} className="border-t border-border/40">
                  <td className="px-3 py-2">{formatDate(r.date)}</td>
                  <td className="px-3 py-2 capitalize">{r.event}</td>
                  <td className="px-3 py-2">{formatUsd(r.amount)}</td>
                  <td className="px-3 py-2">{r.exchange ?? "—"}</td>
                  <td className="px-3 py-2">{r.sub_account ?? "—"}</td>

                  <td className="px-3 py-2">{r.notes ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <span>Page {page}</span>
        <div className="flex gap-2">
          <button
            onClick={onPrev}
            className="px-2 py-1 rounded border border-border hover:bg-accent"
          >
            Prev
          </button>
          <button
            onClick={onNext}
            className="px-2 py-1 rounded border border-border hover:bg-accent"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(d: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(new Date(d));
  } catch {
    return d;
  }
}
