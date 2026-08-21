function money(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return "N/A";
  }

  const n = Number(value);

  let maximumFractionDigits = 2;

  if (Math.abs(n) < 1) {
    if (Math.abs(n) >= 0.1) {
      maximumFractionDigits = 5;
    } else if (Math.abs(n) >= 0.01) {
      maximumFractionDigits = 6;
    } else if (Math.abs(n) >= 0.001) {
      maximumFractionDigits = 8;
    } else {
      maximumFractionDigits = 10;
    }
  }

  return `$${n.toLocaleString("en-US", {
    maximumFractionDigits
  })}`;
}

function pct(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return "N/A";
  }

  return `${Number(value).toFixed(2)}%`;
}

function formatMarketAnalysis(result) {
  const price = result.price;
  const market = result.market || {};
  const alignment = result.alignment || {};
  const plan = result.tradePlan || {};
  const structures = result.structures || {};

  const trends = alignment.trends || {};

  const weeklyLive = result.structures?.["1w"]?.weeklyContext?.direction;

const htf = [
    ["1W", weeklyLive || trends["1w"]],
    ["1D", trends["1d"]],
    ["4H", trends["4h"]],
    ["1H", trends["1h"]]
  ];

  const execution = [
    ["30M", trends["30m"]],
  ];

  const htfText = htf
    .map(([tf, trend]) => `• ${tf}: ${(trend || "unknown").toUpperCase()}`)
    .join("\n");

  const executionText = execution
    .map(([tf, trend]) => `• ${tf}: ${(trend || "unknown").toUpperCase()}`)
    .join("\n");

  const reasons = Array.isArray(alignment.reasons)
    ? alignment.reasons.map(reason => `• ${reason}`).join("\n")
    : "";

  let verdict = "WAIT";

  if (
    alignment.direction === "LONG" &&
    alignment.longAllowed &&
    plan.status !== "WAIT"
  ) {
    verdict = "LONG";
  }

  if (
    alignment.direction === "SHORT" &&
    alignment.shortAllowed &&
    plan.status !== "WAIT"
  ) {
    verdict = "SHORT";
  }

  if (plan.execution?.status === "RR_TOO_LOW") {
    verdict = "WAIT";
  }

  const entry =
    plan.entry != null
      ? money(plan.entry)
      : "Wait for confirmation";

  const stop =
    plan.stop != null
      ? money(plan.stop)
      : "N/A";

  const target =
    plan.target != null
      ? money(plan.target)
      : "N/A";

  const rr =
    plan.riskReward != null
      ? `${Number(plan.riskReward).toFixed(2)}R`
      : "N/A";

  return `
📊 *${result.symbol || "MARKET"} ANALYSIS*

💰 Price: ${money(price)}
📈 24H: ${pct(market.change24hPercent)}

━━━━━━━━━━━━━━━━━━

🧭 *MARKET BIAS*

Primary: ${(alignment.primary || "neutral").toUpperCase()}
Setup: ${(alignment.setup || "neutral").toUpperCase()}
Execution: ${(alignment.execution || "neutral").toUpperCase()}
Direction: ${(alignment.direction || "NEUTRAL").toUpperCase()}

━━━━━━━━━━━━━━━━━━

🏛️ *HIGHER TIMEFRAME*

${htfText}

⚡ *EXECUTION*

${executionText}

━━━━━━━━━━━━━━━━━━

🎯 *TRADE PLAN*

Bias: ${(plan.bias || "NEUTRAL").toUpperCase()}
Verdict: *${verdict}*
Status: ${(plan.status || "WAIT").toUpperCase()}

Entry: ${entry}
Stop: ${stop}
Target: ${target}
Risk/Reward: ${rr}

━━━━━━━━━━━━━━━━━━

🧠 *ENGINE REASONING*

${reasons || "No additional reasoning available."}

━━━━━━━━━━━━━━━━━━

${verdict === "WAIT"
    ? "🛑 *NO TRADE.*\nWait for proper confirmation. Do not chase price."
    : `🚨 *${verdict} SETUP DETECTED.*\nWait for the required execution confirmation before entering.`}
`.trim();
}

module.exports = {
  formatMarketAnalysis
};
