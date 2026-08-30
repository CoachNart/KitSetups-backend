const assert = require("assert");
const { analyzeMarket } = require("./src/tools/marketEngine");

(async () => {
  console.log("========================================");
  console.log("   KITSETUPS ENGINE REGRESSION TEST");
  console.log("========================================");

  const result = await analyzeMarket("BTCUSDT");

  assert(result, "Engine returned no result");
  assert(result.symbol === "BTCUSDT", "Wrong symbol");

  const timeframes = Object.keys(result.structures || {});

  console.log("Timeframes:", timeframes);

  // 15M must be completely removed.
  assert(
    !timeframes.includes("15m"),
    "15M timeframe is still present"
  );

  // 30M is now the minimum execution timeframe.
  assert(
    timeframes.includes("30m"),
    "30M timeframe is missing"
  );

  const alignment = result.alignment || {};
  const plan = result.tradePlan || {};

  console.log("Alignment:", alignment.direction);
  console.log("Reversal watch:", alignment.reversalWatch);
  console.log("Plan:", plan.direction, plan.status);
  console.log("RR:", plan.riskReward);

  // A reversal watch must not produce an executable trade.
  if (alignment.reversalWatch === true) {
    assert(
      plan.status === "WAIT",
      "Reversal watch produced a non-WAIT trade plan"
    );

    assert(
      plan.direction === "WAIT",
      "Reversal watch produced a directional trade"
    );
  }

  // WAIT plans must not manufacture levels.
  if (plan.status === "WAIT") {
    assert(
      plan.entry == null,
      "WAIT plan contains an entry"
    );

    assert(
      plan.stop == null,
      "WAIT plan contains a stop"
    );

    assert(
      plan.target == null,
      "WAIT plan contains a target"
    );
  }

  // Any executable setup must meet the 2R minimum.
  if (
    plan.entry != null &&
    plan.stop != null &&
    plan.target != null
  ) {
    const risk = Math.abs(plan.entry - plan.stop);
    const reward = Math.abs(plan.target - plan.entry);
    const rr = risk > 0 ? reward / risk : null;

    assert(
      rr !== null && rr >= 2,
      `Executable setup failed 2R minimum: ${rr}R`
    );
  }

  console.log("");
  console.log("========================================");
  console.log("✅ ENGINE REGRESSION TEST PASSED");
  console.log("========================================");

})().catch(error => {
  console.error("");
  console.error("❌ ENGINE REGRESSION TEST FAILED");
  console.error(error.stack || error);
  process.exit(1);
});
