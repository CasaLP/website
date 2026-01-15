import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Error: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
    const address = process.argv[2];
    if (!address) {
        console.error("Usage: npx tsx scripts/calculate-fees.ts <account_address>");
        process.exit(1);
    }

    console.log(`Calculating fees for account: ${address}`);

    // 1. Fetch all account_value entries
    const { data: valueData, error: valueError } = await supabase
        .from("account_value")
        .select("date_time, amount")
        .ilike("account", address)
        .order("date_time", { ascending: true });

    if (valueError) {
        console.error("Error fetching account_value:", valueError);
        process.exit(1);
    }

    if (!valueData || valueData.length === 0) {
        console.error("No account value data found for this address.");
        process.exit(1);
    }

    // 2. Fetch all account_history entries
    const { data: historyData, error: historyError } = await supabase
        .from("account_history")
        .select("date, event, amount")
        .ilike("account", address)
        .order("date", { ascending: true });

    if (historyError) {
        console.error("Error fetching account_history:", historyError);
        process.exit(1);
    }

    // 3. Process week by week
    let lastAmount = 0;
    let cumulativeFee = 0;

    console.log("\n" + "".padEnd(80, "-"));
    console.log(
        "Date".padEnd(12) +
        "Gross Amt".padEnd(15) +
        "Weekly Gain".padEnd(15) +
        "Weekly Fee".padEnd(15) +
        "Cumulative Fee"
    );
    console.log("".padEnd(80, "-"));

    for (let i = 0; i < valueData.length; i++) {
        const currentPoint = valueData[i];
        const currentDate = currentPoint.date_time.slice(0, 10);
        const currentAmount = Number(currentPoint.amount) || 0;

        // Last date would be the date of the previous value point (or empty if first)
        const lastDate = i > 0 ? valueData[i - 1].date_time.slice(0, 10) : "";

        // Find cashflows between last snapshot and current snapshot
        // account_history.date is usually YYYY-MM-DD
        let netFlow = 0;
        if (historyData) {
            for (const h of historyData) {
                // If it's the first record, include everything up to currentDate
                // If not, include things strictly after lastDate and on or before currentDate
                const isWithinRange = i === 0
                    ? h.date <= currentDate
                    : h.date > lastDate && h.date <= currentDate;

                if (isWithinRange) {
                    const evt = String(h.event || "").toLowerCase();
                    const amt = Number(h.amount) || 0;
                    if (evt === "deposit") netFlow += amt;
                    else if (evt === "withdrawal") netFlow -= amt;
                }
            }
        }

        // Gain = CurrentGross - (LastGross + NetFlow)
        // For the first entry, we consider the initial value - netFlow as gain
        const gain = i === 0
            ? Math.max(0, currentAmount - netFlow) // Assume gain is what's above the initial netFlow
            : currentAmount - lastAmount - netFlow;

        const weeklyFee = gain > 0 ? gain * 0.25 : 0;
        cumulativeFee += weeklyFee;

        console.log(
            currentDate.padEnd(12) +
            currentAmount.toFixed(2).padEnd(15) +
            gain.toFixed(2).padEnd(15) +
            weeklyFee.toFixed(2).padEnd(15) +
            cumulativeFee.toFixed(2)
        );

        lastAmount = currentAmount;
    }
}

main().catch(console.error);
