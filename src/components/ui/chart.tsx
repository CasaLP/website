"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  TooltipContentProps,
} from "recharts";
import {
  NameType,
  Payload,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

export function LineChartSkeleton() {
  return (
    <div className="h-64 w-full animate-pulse bg-muted/20 rounded-lg flex items-center justify-center">
      <div className="text-muted-foreground/40 text-sm">Loading chart...</div>
    </div>
  );
}

interface ChartDataPoint {
  timestamp: number;
  value: number;
  deposits: number;
}

interface ModernPerformanceChartProps {
  data: ChartDataPoint[];
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: TooltipContentProps<ValueType, NameType>) => {
  if (active && payload && payload.length) {
    const date = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "2-digit",
      year: "numeric",
    }).format(new Date((label as number) * 1000));

    const usdFmt = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 2,
    });

    return (
      <div className="rounded-md border border-border bg-card/95 px-3 py-2 text-xs shadow-xl backdrop-blur-sm">
        <div className="mb-1 font-semibold text-foreground">{date}</div>
        <div className="flex flex-col gap-1">
          {payload.map((entry: Payload<ValueType, NameType>, index: number) => (
            <div
              key={index}
              className="flex items-center justify-between gap-4"
            >
              <span style={{ color: entry.color }} className="font-medium">
                {entry.name}:
              </span>
              <span className="font-mono text-foreground/90">
                {usdFmt.format(entry.value as number)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export function ModernPerformanceChart({ data }: ModernPerformanceChartProps) {
  const usdFmtShort = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        currencyDisplay: "narrowSymbol",
        maximumFractionDigits: 0,
        notation: "compact",
      }),
    [],
  );

  const dateFmtShort = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "2-digit",
      }),
    [],
  );

  if (!data || data.length === 0) {
    return <LineChartSkeleton />;
  }

  return (
    <div className="h-72 w-full pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorDeposits" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.1} />
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            strokeDasharray="3 3"
            stroke="var(--border)"
            opacity={0.4}
          />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(ts) => dateFmtShort.format(new Date(ts * 1000))}
            stroke="var(--muted-foreground)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            minTickGap={30}
          />
          <YAxis
            stroke="var(--muted-foreground)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(val) => usdFmtShort.format(val)}
          />
          <Tooltip content={CustomTooltip} />
          <Area
            type="monotone"
            dataKey="value"
            name="Account Value"
            stroke="var(--chart-2)"
            strokeWidth={2.5}
            fillOpacity={1}
            fill="url(#colorValue)"
            activeDot={{ r: 6, strokeWidth: 0 }}
          />
          <Area
            type="monotone"
            dataKey="deposits"
            name="Total Deposited"
            stroke="var(--chart-1)"
            strokeWidth={2}
            strokeDasharray="5 5"
            fillOpacity={1}
            fill="url(#colorDeposits)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
