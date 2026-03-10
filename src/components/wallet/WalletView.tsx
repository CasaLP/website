"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  LineChartSkeleton,
  ModernPerformanceChart,
} from "@/components/ui/chart";
import { supabase } from "@/lib/supabase";

export function WalletView({ address }: { address: string }) {
  const [period, setPeriod] = useState<"30D" | "90D" | "365D">("365D");
  const [tab, setTab] = useState<"overview" | "history" | "details">(
    "overview",
  );
  const [history, setHistory] = useState<
    Array<{
      date: string;
      event: string;
      amount: number;
      exchange?: string | null;
    }>
  >([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [sortConfig, setSortConfig] = useState<{
    key: "timestamp" | "type" | "amount" | "method";
    direction: "asc" | "desc";
  }>({ key: "timestamp", direction: "desc" });
  const pageSize = 25;

  const handleSort = (key: typeof sortConfig.key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "desc" ? "asc" : "desc",
    }));
    setHistoryPage(1); // Reset to first page on sort
  };
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [profitShare, setProfitShare] = useState<number | null>(0.25);
  // Overview aggregates
  const [totalDeposits, setTotalDeposits] = useState<number | null>(null);
  const [pendingDeposits, setPendingDeposits] = useState<number | null>(null);
  const [apy7d, setApy7d] = useState<number | null>(null);
  const [apy30d, setApy30d] = useState<number | null>(null);
  const [apy90d, setApy90d] = useState<number | null>(null);

  const [accountId, setAccountId] = useState<number | null>(null);

  // Fetch account ID first
  useEffect(() => {
    let cancelled = false;
    async function fetchAccountId() {
      if (!address || !address.trim()) {
        setAccountId(null);
        return;
      }
      try {
        // Use ilike for case-insensitive match on address
        const { data, error } = await supabase
          .from("accounts_migration")
          .select("id")
          .ilike("address", address)
          .maybeSingle(); // Use maybeSingle to avoid 406 if multiple matches (should be unique) or 0 matches

        if (!cancelled) {
          if (!error && data) {
            setAccountId(data.id);
          } else {
            console.warn("Account not found for address:", address, error);
            setAccountId(null);
          }
        }
      } catch (e) {
        console.error("Error fetching account ID", e);
      }
    }
    fetchAccountId();
    return () => {
      cancelled = true;
    };
  }, [address]);

  // Prefetch overview aggregates (sum deposits - withdrawals) from transactions
  useEffect(() => {
    let cancelled = false;
    async function loadAggregates() {
      try {
        if (!accountId) return;
        const { data, error } = await supabase
          .from("transactions_migration")
          .select("type, amount, timestamp")
          .eq("account_id", accountId);

        if (!cancelled) {
          if (!error && Array.isArray(data)) {
            const lastSunday = getLastSunday();
            const lastSundayStr = lastSunday.toISOString().slice(0, 10); // Use date-only for comparison if data is date-only

            let deposits = 0;
            let withdrawals = 0;
            let pDeposits = 0;
            let pWithdrawals = 0;

            for (const r of data as any[]) {
              const evt = String(r.type ?? "").toLowerCase();
              const amt = Number(r.amount) || 0;
              const ts = String(r.timestamp ?? "");
              const date = ts.slice(0, 10);

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
  }, [accountId]);

  // History fetch from transactions
  useEffect(() => {
    if (tab !== "history") return;
    let cancelled = false;
    async function loadHistory() {
      if (!accountId) return;
      const from = (historyPage - 1) * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from("transactions_migration")
        .select("timestamp, type, amount, method")
        .eq("account_id", accountId)
        .order(sortConfig.key, { ascending: sortConfig.direction === "asc" })
        .range(from, to);
      if (!cancelled) {
        if (!error && data) {
          setHistoryError(null);
          setHistory(
            (data as any[]).map((r: any) => ({
              date: r.timestamp,
              event: String(r.type ?? "").toLowerCase(),
              amount: Number(r.amount),
              exchange: r.method ?? null,
            })),
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
  }, [tab, accountId, historyPage, sortConfig]);

  // Value series fetch from weekly_snapshots
  const [valueSeries, setValueSeries] = useState<Array<[number, number]>>([]);
  const [depositSeries, setDepositSeries] = useState<Array<[number, number]>>(
    [],
  );
  const currentValue = useMemo(() => {
    if (valueSeries.length === 0) return undefined;
    return valueSeries[valueSeries.length - 1][1];
  }, [valueSeries]);

  const chartData = useMemo(() => {
    return valueSeries.map(([ts, val], i) => ({
      timestamp: ts,
      value: val,
      deposits: depositSeries[i]?.[1] ?? 0,
    }));
  }, [valueSeries, depositSeries]);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      try {
        if (!accountId) return;
        const now = new Date();
        const lastSunday = getLastSunday();
        const lastSundayStr = lastSunday.toISOString().slice(0, 10);

        const cutoff = new Date(now);
        if (period === "30D") cutoff.setDate(now.getDate() - 30);
        else if (period === "90D") cutoff.setDate(now.getDate() - 90);
        else cutoff.setDate(now.getDate() - 365);
        const cutoffStr = cutoff.toISOString().slice(0, 10);

        // Load weekly snapshots
        const [snapsRes, priorFlowRes] = await Promise.all([
          supabase
            .from("weekly_snapshots_migration")
            .select(
              "week_ending, total_value, net_contributions, fee_accrued_unsettled, fee_accrued_settled",
            )
            .eq("account_id", accountId)
            .gte("week_ending", cutoffStr)
            .lte("week_ending", lastSundayStr)
            .order("week_ending", { ascending: true }),
          supabase
            .from("weekly_snapshots_migration")
            .select("net_contributions")
            .eq("account_id", accountId)
            .lt("week_ending", cutoffStr),
        ]);

        if (cancelled) return;

        let seriesVals: Array<[number, number]> = [];
        let seriesDeps: Array<[number, number]> = [];
        let cumNetFlow = 0;

        if (!priorFlowRes.error && priorFlowRes.data) {
          cumNetFlow = (priorFlowRes.data as any[]).reduce(
            (sum, r) => sum + (Number(r.net_contributions) || 0),
            0,
          );
        }

        if (!snapsRes.error && Array.isArray(snapsRes.data)) {
          // Process snapshots
          const snaps = (snapsRes.data as any[])
            .map((r: any) => ({
              ts: Math.floor(new Date(r.week_ending).getTime() / 1000),
              val:
                (Number(r.total_value) || 0) -
                (Number(r.fee_accrued_unsettled) || 0) -
                (Number(r.fee_accrued_settled) || 0),
              flow: Number(r.net_contributions) || 0,
            }))
            .sort((a, b) => a.ts - b.ts);

          // We need an initial cumulative deposit value.
          // Since we only have snapshots in the window, we might miss prior deposits.
          // For visualization, we can start cumNetFlow at 0 or try to fetch sum of all prior net_contributions.
          // Let's try to fetch prior sum to be accurate on "Total Deposited" line if possible,
          // or just accumulate from window start.
          // Simplified approach: accumulate from window start (relative to chart start).

          for (const s of snaps) {
            seriesVals.push([s.ts, s.val]);
            cumNetFlow += s.flow;
            seriesDeps.push([s.ts, cumNetFlow]);
          }

          setValueSeries(seriesVals);
          setDepositSeries(seriesDeps);
        } else {
          setValueSeries([]);
          setDepositSeries([]);
        }
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
  }, [accountId, period]);

  // Helper function to compute APY for a given number of weeks by averaging weekly performance
  async function computeApyForWeeks(
    weeks: number,
    setApy: (apy: number | null) => void,
    cancelled: { current: boolean },
  ) {
    try {
      if (!accountId) return setApy(null);

      const requestedEndSunday = getLastSunday();
      const cutoff = new Date(requestedEndSunday);
      cutoff.setUTCDate(cutoff.getUTCDate() - weeks * 7);
      cutoff.setUTCDate(cutoff.getUTCDate() - 7); // Add buffer for start point
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      // 1. Fetch weekly snapshots
      const { data, error } = await supabase
        .from("weekly_snapshots_migration")
        .select(
          "week_ending, total_value, net_contributions, fee_accrued_unsettled, fee_accrued_settled",
        )
        .eq("account_id", accountId)
        .gte("week_ending", cutoffStr)
        .order("week_ending", { ascending: true });

      if (cancelled.current) return;

      if (error || !Array.isArray(data)) {
        setApy(null);
        return;
      }

      const snaps = data
        .map((r: any) => ({
          ts: Math.floor(new Date(r.week_ending).getTime() / 1000),
          val:
            (Number(r.total_value) || 0) -
            (Number(r.fee_accrued_unsettled) || 0) -
            (Number(r.fee_accrued_settled) || 0),
          flow: Number(r.net_contributions) || 0,
        }))
        .sort((a, b) => a.ts - b.ts);

      if (snaps.length < 2) {
        setApy(null);
        return;
      }

      // 2. Iterate week by week and calculate weekly return
      const weeklyApys: number[] = [];
      let currentEndSunday = requestedEndSunday;
      const currentEndTs = Math.floor(currentEndSunday.getTime() / 1000);

      // Find indices in sorted snaps
      // We need to walk backwards from requestedEndSunday 'weeks' times.

      for (let i = 0; i < weeks; i++) {
        // Target Sunday for end of this week
        const targetEndTs = currentEndTs - i * 7 * 24 * 3600;
        // Target Sunday for start of this week (previous week end)
        const targetStartTs = targetEndTs - 7 * 24 * 3600;

        // Find points in snaps approx matching these timestamps
        const endSnap = snaps.find(
          (s) => Math.abs(s.ts - targetEndTs) < 3 * 24 * 3600,
        );
        const startSnap = snaps.find(
          (s) => Math.abs(s.ts - targetStartTs) < 3 * 24 * 3600,
        );

        if (startSnap && endSnap) {
          const startValue = startSnap.val;
          const endValue = endSnap.val;
          const startTs = startSnap.ts;
          const endTs = endSnap.ts;
          // The flow for this week is in the endSnap
          const flowAmount = endSnap.flow;

          // Dietz calculation for one week
          // Flow is assumed to be at endTs (snapshot time)
          const flows = [{ ts: endTs, amount: flowAmount }];

          const r = modifiedDietzReturn({
            startValue,
            endValue,
            startTs,
            endTs,
            flows,
          });

          if (Number.isFinite(r)) {
            // Annualize: (1+r)^52 - 1 approximately, or (1+r)^(365/7)
            const days = (endTs - startTs) / 86400;
            const annual = Math.pow(1 + r, 365 / days) - 1;
            weeklyApys.push(annual);
          }
        }
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
  }, [accountId]);

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
      </header>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Performance
          </h2>
          <PeriodToggle value={period} onChange={setPeriod} />
        </div>
        {chartData.length > 0 ? (
          <ModernPerformanceChart data={chartData} />
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
            sortConfig={sortConfig}
            onSort={handleSort}
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
  value: "30D" | "90D" | "365D";
  onChange: (v: "30D" | "90D" | "365D") => void;
}) {
  const options: Array<"30D" | "90D" | "365D"> = ["30D", "90D", "365D"];
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
    <div className="flex flex-wrap gap-4">
      <StatCard
        label="Total Deposits"
        value={formatUsd(totalDeposits ?? 0)}
        subValue={
          pendingDeposits && pendingDeposits !== 0
            ? `(${pendingDeposits > 0 ? "+" : ""}${formatUsd(
                pendingDeposits,
              )} pending)`
            : undefined
        }
        className="flex-1 min-w-[calc(50%-8px)] md:min-w-[calc(33.33%-11px)]"
      />
      <StatCard
        label="Current Value"
        value={formatUsd(currentValue)}
        className="flex-1 min-w-[calc(50%-8px)] md:min-w-[calc(33.33%-11px)]"
      />
      <StatCard
        label="Total Return"
        value={formatUsd(totalReturn ?? undefined)}
        className="flex-1 min-w-[calc(50%-8px)] md:min-w-[calc(33.33%-11px)]"
      />
      <StatCard
        label="7D Avg APY"
        value={formatPctOrDash(apy7d)}
        className="flex-1 min-w-[calc(50%-8px)] md:min-w-[calc(33.33%-11px)]"
      />
      <StatCard
        label="30D Avg APY"
        value={formatPctOrDash(apy30d)}
        className="flex-1 min-w-[calc(50%-8px)] md:min-w-[calc(33.33%-11px)]"
      />
      <StatCard
        label="90D Avg APY"
        value={formatPctOrDash(apy90d)}
        className="flex-1 min-w-[calc(50%-8px)] md:min-w-[calc(33.33%-11px)]"
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  subValue,
  className = "",
}: {
  label: string;
  value: string;
  subValue?: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-border bg-card p-4 shadow-sm ${className}`}
    >
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
      <div className="flex flex-wrap gap-4">
        <StatCard
          label="Account"
          value={address}
          className="flex-1 min-w-[calc(100%-8px)] md:min-w-[calc(75%-11px)]"
        />
        <StatCard
          label="Profit Share"
          value={profitShareString}
          className="flex-1 min-w-[calc(100%-8px)] md:min-w-[calc(25%-11px)]"
        />
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
  sortConfig,
  onSort,
  onPrev,
  onNext,
  error,
}: {
  rows: Array<{
    date: string;
    event: string;
    amount: number;
    exchange?: string | null;
  }>;
  page: number;
  pageSize: number;
  sortConfig: {
    key: "timestamp" | "type" | "amount" | "method";
    direction: "asc" | "desc";
  };
  onSort: (key: "timestamp" | "type" | "amount" | "method") => void;
  onPrev: () => void;
  onNext: () => void;
  error?: string | null;
}) {
  const getSortIcon = (key: typeof sortConfig.key) => {
    if (sortConfig.key !== key)
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
    return sortConfig.direction === "asc" ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th
                onClick={() => onSort("timestamp")}
                className="px-3 py-2 cursor-pointer hover:bg-accent/50 select-none"
              >
                <div className="flex items-center">
                  Date {getSortIcon("timestamp")}
                </div>
              </th>
              <th
                onClick={() => onSort("type")}
                className="px-3 py-2 cursor-pointer hover:bg-accent/50 select-none"
              >
                <div className="flex items-center">
                  Action {getSortIcon("type")}
                </div>
              </th>
              <th
                onClick={() => onSort("amount")}
                className="px-3 py-2 cursor-pointer hover:bg-accent/50 select-none"
              >
                <div className="flex items-center">
                  Amount {getSortIcon("amount")}
                </div>
              </th>
              <th
                onClick={() => onSort("method")}
                className="px-3 py-2 cursor-pointer hover:bg-accent/50 select-none"
              >
                <div className="flex items-center">
                  Method {getSortIcon("method")}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-6 text-center text-muted-foreground"
                  colSpan={4}
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
  lastSunday.setUTCHours(23, 59, 59, 999);
  return lastSunday;
}
