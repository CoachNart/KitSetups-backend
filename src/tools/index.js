async function calculator(expression) {
  /*
   * Basic calculator hook.
   * We intentionally keep this isolated from the AI.
   */
  if (!/^[0-9+\-*/().%\s]+$/.test(expression)) {
    throw new Error(
      "Unsupported calculation."
    );
  }

  return Function(
    `"use strict"; return (${expression})`
  )();
}

module.exports = {
  calculator
};
