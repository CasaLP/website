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
  const [tab, setTab] = useState<"overview" | "history" | "details">(
    "overview"
  );
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
  const [profitShare, setProfitShare] = useState<number | null>(0.25);
  // Overview aggregates
  const [totalDeposits, setTotalDeposits] = useState<number | null>(null);
  const [pendingDeposits, setPendingDeposits] = useState<number | null>(null);
  const [apy7d, setApy7d] = useState<number | null>(null);
  const [apy30d, setApy30d] = useState<number | null>(null);
  const [apy90d, setApy90d] = useState<number | null>(null);

  // Prefetch overview aggregates (sum deposits - withdrawals) from account_history
  useEffect(() => {
    let cancelled = false;
    async function loadAggregates() {
      try {
        if (!address || !address.trim()) return;
        const { data, error } = await supabase
          .from("account_history")
          .select("event,amount,date")
          .ilike("account", address);
        if (!cancelled) {
          if (!error && Array.isArray(data)) {
            const lastSunday = getLastSunday();
            const lastSundayStr = lastSunday.toISOString().slice(0, 10);

            let deposits = 0;
            let withdrawals = 0;
            let pDeposits = 0;
            let pWithdrawals = 0;

            for (const r of data as any[]) {
              const evt = String(r.event ?? "").toLowerCase();
              const amt = Number(r.amount) || 0;
              const date = String(r.date ?? "");

              if (date <= lastSundayStr) {
                if (evt === "deposit") deposits += amt;
                else if (evt === "withdrawal") withdrawals += amt;
              } else {
                if (evt === "deposit") pDeposits += amt;
                else if (evt === "withdrawal") pWithdrawals += amt;
              }
            }
            setTotalDeposits(deposits - withdrawals);
            setPendingDeposits(pDeposits - pWithdrawals);
          } else {
            setTotalDeposits(0);
            setPendingDeposits(0);
          }
        }
      } catch {
        if (!cancelled) {
          setTotalDeposits(0);
          setPendingDeposits(0);
        }
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
        const lastSunday = getLastSunday();
        const lastSundayStr = lastSunday.toISOString().slice(0, 10);

        const cutoff = new Date(now);
        if (period === "30D") cutoff.setDate(now.getDate() - 30);
        else cutoff.setDate(now.getDate() - 365);
        const cutoffStr = cutoff.toISOString().slice(0, 10);

        // Load values first
        const valsRes = await supabase
          .from("account_value")
          .select("date_time, amount, total_fee")
          .ilike("account", address)
          .gte("date_time", cutoffStr)
          .lte("date_time", lastSundayStr)
          .order("date_time", { ascending: true });
        if (cancelled) return;

        let seriesVals: Array<[number, number]> = [];
        if (!valsRes.error && Array.isArray(valsRes.data)) {
          seriesVals = (valsRes.data as any[])
            .map((r: any) => [
              Math.floor(new Date(r.date_time).getTime() / 1000),
              (Number(r.amount) || 0) - (Number(r.total_fee) || 0),
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


  // Helper function to find the Sunday data point closest to a target date
  function findSundayDataPoint(
    series: Array<[number, number]>,
    targetSunday: Date
  ): [number, number] | null {
    const targetTs = Math.floor(targetSunday.getTime() / 1000);
    // Look for data points on or within a few days of the target Sunday
    // Since data is stored on Sundays, we look for points within 3 days
    let bestPoint: [number, number] | null = null;
    let minDiff = Infinity;

    for (const point of series) {
      const diff = Math.abs(point[0] - targetTs);
      // Accept points within 3 days (in case of slight timing differences)
      if (diff <= 3 * 24 * 60 * 60 && diff < minDiff) {
        minDiff = diff;
        bestPoint = point;
      }
    }

    return bestPoint;
  }

  // Helper function to compute APY for a given number of weeks by averaging weekly performance
  async function computeApyForWeeks(
    weeks: number,
    setApy: (apy: number | null) => void,
    cancelled: { current: boolean }
  ) {
    try {
      if (!address || !address.trim()) return setApy(null);

      const requestedEndSunday = getLastSunday();
      const cutoff = new Date(requestedEndSunday);
      cutoff.setUTCDate(cutoff.getUTCDate() - weeks * 7);
      cutoff.setUTCDate(cutoff.getUTCDate() - 7); // Add buffer
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      // 1. Fetch all necessary value points and flows once
      const [valsRes, flowsRes] = await Promise.all([
        supabase
          .from("account_value")
          .select("date_time, amount, total_fee")
          .ilike("account", address)
          .gte("date_time", cutoffStr)
          .order("date_time", { ascending: true }),
        supabase
          .from("account_history")
          .select("date, event, amount")
          .ilike("account", address)
          .gte("date", cutoffStr)
          .order("date", { ascending: true }),
      ]);

      if (cancelled.current) return;

      if (valsRes.error || !Array.isArray(valsRes.data)) {
        setApy(null);
        return;
      }

      const seriesVals: Array<[number, number]> = valsRes.data
        .map((r: any) => [
          Math.floor(new Date(r.date_time).getTime() / 1000),
          (Number(r.amount) || 0) - (Number(r.total_fee) || 0),
        ])
        .filter((p): p is [number, number] => Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .sort((a, b) => a[0] - b[0]);

      if (seriesVals.length < 2) {
        setApy(null);
        return;
      }

      const allFlows: Array<{ ts: number; amount: number }> = (flowsRes.data || [])
        .map((r: any) => {
          const evt = String(r.event ?? "").trim().toLowerCase();
          const sign = evt === "withdrawal" ? -1 : 1;
          const ts = Math.floor(new Date(r.date).getTime() / 1000);
          const amt = sign * (Number(r.amount) || 0);
          return { ts, amount: amt, isValid: (evt === "deposit" || evt === "withdrawal") && Number.isFinite(ts) && Number.isFinite(amt) };
        })
        .filter(f => f.isValid)
        .map(f => ({ ts: f.ts, amount: f.amount }));

      // 2. Iterate week by week and calculate weekly return
      const weeklyApys: number[] = [];
      let currentEndSunday = requestedEndSunday;

      for (let i = 0; i < weeks; i++) {
        const weekStartSunday = new Date(currentEndSunday);
        weekStartSunday.setUTCDate(currentEndSunday.getUTCDate() - 7);

        const startPoint = findSundayDataPoint(seriesVals, weekStartSunday);
        const endPoint = findSundayDataPoint(seriesVals, currentEndSunday);

        if (startPoint && endPoint && startPoint[0] < endPoint[0]) {
          const startValue = startPoint[1];
          const endValue = endPoint[1];
          const startTs = startPoint[0];
          const endTs = endPoint[0];

          // Flows within this specific week
          const weeklyFlows = allFlows.filter(f => f.ts > startTs && f.ts <= endTs);

          const r = modifiedDietzReturn({
            startValue,
            endValue,
            startTs,
            endTs,
            flows: weeklyFlows,
          });

          if (Number.isFinite(r)) {
            // Annualize the weekly return: (1+r)^(365/days) - 1
            const days = (endTs - startTs) / (24 * 60 * 60);
            const weeklyApy = Math.pow(1 + r, 365 / days) - 1;
            weeklyApys.push(weeklyApy);
          }
        }

        // Move back one week
        currentEndSunday = weekStartSunday;
      }

      if (weeklyApys.length === 0) {
        setApy(null);
        return;
      }

      // 3. Average the weekly APYs
      const avgApy = weeklyApys.reduce((a, b) => a + b, 0) / weeklyApys.length;
      setApy(avgApy);
    } catch (err) {
      console.error("APY calculation error:", err);
      if (!cancelled.current) setApy(null);
    }
  }

  // Compute 7D, 30D, and 90D APY using Modified Dietz to neutralize deposits/withdrawals
  useEffect(() => {
    let cancelled = { current: false };
    async function computeApys() {
      await Promise.all([
        computeApyForWeeks(1, setApy7d, cancelled), // 7D (1 week)
        computeApyForWeeks(4, setApy30d, cancelled), // 30D (4 weeks)
        computeApyForWeeks(12, setApy90d, cancelled), // 90D (12 weeks)
      ]);
    }
    computeApys();
    return () => {
      cancelled.current = true;
    };
  }, [address]);

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
            pendingDeposits={pendingDeposits}
            apy7d={apy7d}
            apy30d={apy30d}
            apy90d={apy90d}
          />
        ) : tab === "history" ? (
          <HistoryTable
            rows={history}
            page={historyPage}
            pageSize={pageSize}
            onPrev={() => setHistoryPage((p) => Math.max(1, p - 1))}
            onNext={() => setHistoryPage((p) => p + 1)}
            error={historyError}
          />
        ) : (
          <DetailsPanel address={address} profitShare={profitShare} />
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
    // Find deposits at the start and end of the visible period
    const depStart = findAtOrBefore(deposits, tsMin) ?? 0;
    const depEnd = findAtOrBefore(deposits, tsMax) ?? depStart;

    // Calculate return for the period shown in the chart
    // This accounts for deposits/withdrawals during the period
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

// Computes the total return percentage over the period
// Accounts for deposits/withdrawals: return = (endValue - startValue - netDeposits) / denominator
// Uses starting deposits if meaningful, otherwise falls back to end deposits or starting value
// This prevents division by very small numbers that cause inflated percentages
function computePctFromDeposits(
  startVal: number,
  startDep: number,
  endVal: number,
  endDep: number
) {
  const netDeposits = endDep - startDep;
  const valueChange = endVal - startVal;
  const netReturn = valueChange - netDeposits;

  // Prefer starting deposits if they're meaningful (at least 10% of end deposits or > $100)
  if (Math.abs(startDep) > Math.max(100, Math.abs(endDep) * 0.1)) {
    return netReturn / startDep;
  }

  // If starting deposits are too small, use end deposits if available
  // This handles cases where most deposits were made during the period
  if (Math.abs(endDep) > 1e-9) {
    return netReturn / endDep;
  }

  // Fall back to starting value if deposits aren't available
  if (Math.abs(startVal) > 1e-9) {
    return netReturn / startVal;
  }

  // If all are zero or very small, can't compute meaningful return
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
  value: "overview" | "history" | "details";
  onChange: (v: "overview" | "history" | "details") => void;
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
      <button
        onClick={() => onChange("details")}
        className={
          "px-3 py-2 text-sm -mb-px border-b-2 " +
          (value === "details"
            ? "border-primary text-primary"
            : "border-transparent text-muted-foreground hover:text-foreground")
        }
      >
        Details
      </button>
    </div>
  );
}

function OverviewCards({
  currentValue,
  totalDeposits,
  pendingDeposits,
  apy7d,
  apy30d,
  apy90d,
}: {
  currentValue?: number;
  totalDeposits: number | null;
  pendingDeposits: number | null;
  apy7d: number | null;
  apy30d: number | null;
  apy90d: number | null;
}) {
  // Calculate total return in USD
  const totalReturn =
    currentValue !== undefined &&
      totalDeposits !== null &&
      Number.isFinite(currentValue) &&
      Number.isFinite(totalDeposits)
      ? currentValue - totalDeposits
      : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Total Deposits"
          value={formatUsd(totalDeposits ?? 0)}
          subValue={
            pendingDeposits && pendingDeposits !== 0
              ? `(${pendingDeposits > 0 ? "+" : ""}${formatUsd(
                pendingDeposits
              )} pending)`
              : undefined
          }
        />
        <StatCard label="Current Value" value={formatUsd(currentValue)} />
        <StatCard
          label="Total Return"
          value={formatUsd(totalReturn ?? undefined)}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="7D Avg APY" value={formatPctOrDash(apy7d)} />
        <StatCard label="30D Avg APY" value={formatPctOrDash(apy30d)} />
        <StatCard label="90D Avg APY" value={formatPctOrDash(apy90d)} />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  subValue,
}: {
  label: string;
  value: string;
  subValue?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-2">
        <span className="text-xl font-semibold break-all">{value}</span>
        {subValue && (
          <span className="text-sm text-muted-foreground">{subValue}</span>
        )}
      </div>
    </div>
  );
}

function DetailsPanel({
  address,
  profitShare,
}: {
  address: string;
  profitShare: number | null;
}) {
  const profitShareString: string =
    profitShare != null && Number.isFinite(profitShare)
      ? `${(profitShare * 100).toFixed(0)}%`
      : "—";
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <StatCard label="Account" value={address} />
        <StatCard label="Profit Share" value={profitShareString} />
      </div>
    </>
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

// Helper function to get the most recent Sunday (or today if it's Sunday)
function getLastSunday(): Date {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sunday, 6=Saturday
  const lastSunday = new Date(now);
  lastSunday.setUTCDate(now.getUTCDate() - day);
  lastSunday.setUTCHours(0, 0, 0, 0);
  return lastSunday;
}
