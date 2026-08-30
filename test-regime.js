const {
  determineRegime,
} = require("./src/services/regime");

function structure(
  state,
  confidence,
  transition = null,
  trend = state
) {
  return {
    state,
    trend,
    confidence,
    transition,
  };
}

const scenarios = [
  {
    name: "1. Strong HTF bullish structure",
    structures: {
      "1w": structure("BULLISH", 90),
      "1d": structure("BULLISH", 85),
      "4h": structure("BULLISH", 80),
      "1h": structure("BULLISH", 70),
      "30m": structure("BEARISH", 50),
    },
  },

  {
    name: "2. Strong HTF bearish structure",
    structures: {
      "1w": structure("BEARISH", 90),
      "1d": structure("BEARISH", 85),
      "4h": structure("BEARISH", 80),
      "1h": structure("BULLISH", 50),
      "30m": structure("BULLISH", 60),
    },
  },

  {
    name: "3. HTF bullish transition + lower TF bullish",
    structures: {
      "1w": structure(
        "BULLISH",
        75,
        {
          type: "CHOCH",
          direction: "BULLISH",
          level: 67000,
          timestamp: Date.now(),
        },
        "BEARISH"
      ),
      "1d": structure(
        "BULLISH",
        75,
        {
          type: "BOS",
          direction: "BULLISH",
          level: 65000,
          timestamp: Date.now(),
        },
        "BEARISH"
      ),
      "4h": structure("RANGE", 40),
      "1h": structure("BULLISH", 60),
      "30m": structure("BULLISH", 60),
    },
  },

  {
    name: "4. HTF conflict",
    structures: {
      "1w": structure("BEARISH", 85),
      "1d": structure("BULLISH", 80),
      "4h": structure("RANGE", 40),
      "1h": structure("BULLISH", 70),
      "30m": structure("BULLISH", 70),
    },
  },

  {
    name: "5. Everything ranging",
    structures: {
      "1w": structure("RANGE", 80),
      "1d": structure("RANGE", 80),
      "4h": structure("RANGE", 70),
      "1h": structure("RANGE", 60),
      "30m": structure("RANGE", 60),
    },
  },

  {
    name: "6. Only lower timeframe bullish",
    structures: {
      "1w": structure("RANGE", 80),
      "1d": structure("RANGE", 80),
      "4h": structure("RANGE", 70),
      "1h": structure("BULLISH", 70),
      "30m": structure("BULLISH", 70),
    },
  },

  {
    name: "7. Missing data",
    structures: {
      "1w": null,
      "1d": null,
      "4h": null,
      "1h": structure("BULLISH", 60),
      "30m": structure("BULLISH", 60),
    },
  },

  {
    name: "8. Fresh bearish transition against bullish lower TF",
    structures: {
      "1w": structure(
        "BEARISH",
        80,
        {
          type: "CHOCH",
          direction: "BEARISH",
          level: 70000,
          timestamp: Date.now(),
        },
        "BULLISH"
      ),
      "1d": structure(
        "BEARISH",
        75,
        {
          type: "BOS",
          direction: "BEARISH",
          level: 68000,
          timestamp: Date.now(),
        },
        "BULLISH"
      ),
      "4h": structure("RANGE", 40),
      "1h": structure("BULLISH", 65),
      "30m": structure("BULLISH", 65),
    },
  },
];

for (const scenario of scenarios) {
  const result =
    determineRegime(
      scenario.structures
    );

  console.log(
    "\n========================================"
  );

  console.log(
    scenario.name
  );

  console.log(
    "========================================"
  );

  console.log(
    "Direction:",
    result.direction
  );

  console.log(
    "State:",
    result.state
  );

  console.log(
    "Score:",
    result.score
  );

  console.log(
    "Confidence:",
    result.confidence
  );

  console.log(
    "Bullish weight:",
    result.bullishWeight
  );

  console.log(
    "Bearish weight:",
    result.bearishWeight
  );

  console.log(
    "Net score:",
    result.netScore
  );
}

console.log(
  "\n========================================"
);

console.log(
  "REGIME ENGINE TEST COMPLETE"
);

console.log(
  "========================================"
);
