const https = require("https");
const { db, userRef } = require("../services/firestore");
const { requireAuth } = require("../middleware/auth");
const { addDays, PREMIUM_DAYS } = require("../services/access");

const BSC_CHAIN_ID = "0x38";
const USDT_BSC = "0x55d398326f99059ff775485246999027b3197955";
const TRANSFER_SELECTOR = "a9059cbb";

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });
  res.end(JSON.stringify(data));
}

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function rpc(method, params = []) {
  const endpoint = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/";
  const url = new URL(endpoint);

  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params,
  });

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 12_000,
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed.error) {
              reject(new Error(parsed.error.message || "BSC RPC error"));
              return;
            }
            resolve(parsed.result);
          } catch (error) {
            reject(new Error(`Invalid BSC RPC response: ${error.message}`));
          }
        });
      },
    );

    request.on("timeout", () => request.destroy(new Error("BSC RPC timeout")));
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function parseTransferInput(input) {
  const value = String(input || "").replace(/^0x/, "");

  if (!value.startsWith(TRANSFER_SELECTOR) || value.length < 136) {
    return null;
  }

  const recipientWord = value.slice(8, 72);
  const amountWord = value.slice(72, 136);

  return {
    recipient: `0x${recipientWord.slice(-40)}`,
    amountRaw: BigInt(`0x${amountWord}`),
  };
}

function minimumAmountRaw() {
  const configured = Number(process.env.PREMIUM_PRICE_USDT || 30);
  if (!Number.isFinite(configured) || configured <= 0) {
    throw new Error("Invalid PREMIUM_PRICE_USDT configuration");
  }

  // BSC USDT uses 18 decimals.
  return BigInt(Math.round(configured * 1e18));
}

async function paymentRoutes(req, res) {
  if (req.method !== "POST" || req.url !== "/api/payment/verify") {
    return false;
  }

  return requireAuth(req, res, async () => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);

      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        return json(res, 400, {
          ok: false,
          error: "Invalid JSON body",
          code: "INVALID_REQUEST",
        });
      }

      const txHash = String(body.txHash || "").trim().toLowerCase();
      if (!/^0x[a-f0-9]{64}$/.test(txHash)) {
        return json(res, 400, {
          ok: false,
          error: "Invalid BNB Chain transaction hash",
          code: "INVALID_TX_HASH",
        });
      }

      const uid = req.user.uid;
      const paymentRef = db.collection("payments").doc(txHash);
      const existingPayment = await paymentRef.get();

      if (existingPayment.exists) {
        const payment = existingPayment.data() || {};
        if (payment.uid === uid && payment.status === "verified") {
          return json(res, 200, {
            ok: true,
            data: { alreadyVerified: true },
          });
        }

        return json(res, 409, {
          ok: false,
          error: "This transaction has already been used",
          code: "TX_ALREADY_USED",
        });
      }

      const [chainId, transaction, receipt] = await Promise.all([
        rpc("eth_chainId"),
        rpc("eth_getTransactionByHash", [txHash]),
        rpc("eth_getTransactionReceipt", [txHash]),
      ]);

      if (chainId !== BSC_CHAIN_ID) {
        return json(res, 503, {
          ok: false,
          error: "Payment verifier is not connected to BNB Smart Chain",
          code: "PAYMENT_NETWORK_MISCONFIGURED",
        });
      }

      if (!transaction || !receipt) {
        return json(res, 400, {
          ok: false,
          error: "Transaction not found or not confirmed yet",
          code: "TX_NOT_CONFIRMED",
        });
      }

      if (receipt.status !== "0x1") {
        return json(res, 400, {
          ok: false,
          error: "Transaction failed on BNB Chain",
          code: "TX_FAILED",
        });
      }

      const confirmations = receipt.blockNumber
        ? Number(BigInt(await rpc("eth_blockNumber")) - BigInt(receipt.blockNumber))
        : 0;

      if (confirmations < 3) {
        return json(res, 400, {
          ok: false,
          error: "Transaction is confirmed but still waiting for additional confirmations",
          code: "TX_CONFIRMATIONS_PENDING",
        });
      }

      const configuredRecipient = normalizeAddress(
        process.env.PAYMENT_RECEIVING_ADDRESS ||
          "0x1c35bf9d920e1b5d7e7e37ce1d15a1b9500f8474",
      );
      const tokenContract = normalizeAddress(
        process.env.PAYMENT_TOKEN_CONTRACT || USDT_BSC,
      );

      if (normalizeAddress(transaction.to) !== tokenContract) {
        return json(res, 400, {
          ok: false,
          error: "Transaction is not a USDT transfer on BNB Smart Chain",
          code: "WRONG_TOKEN",
        });
      }

      const transfer = parseTransferInput(transaction.input);
      if (!transfer || normalizeAddress(transfer.recipient) !== configuredRecipient) {
        return json(res, 400, {
          ok: false,
          error: "Payment was not sent to the KitSetups payment address",
          code: "WRONG_RECIPIENT",
        });
      }

      if (transfer.amountRaw < minimumAmountRaw()) {
        return json(res, 400, {
          ok: false,
          error: "Payment amount is below the Premium subscription price",
          code: "INSUFFICIENT_PAYMENT",
        });
      }

      const accountRef = userRef(uid);
      const accountSnap = await accountRef.get();

      if (!accountSnap.exists) {
        return json(res, 404, {
          ok: false,
          error: "KitSetups account not found",
          code: "ACCOUNT_NOT_FOUND",
        });
      }

      const now = new Date();
      const account = accountSnap.data() || {};
      const currentEnd = account.subscriptionEndsAt
        ? new Date(account.subscriptionEndsAt)
        : now;
      const subscriptionStart = currentEnd > now ? currentEnd : now;
      const subscriptionEndsAt = addDays(subscriptionStart, PREMIUM_DAYS).toISOString();

      await db.runTransaction(async (tx) => {
        const freshPayment = await tx.get(paymentRef);
        if (freshPayment.exists) {
          throw new Error("TX_ALREADY_USED");
        }

        tx.set(paymentRef, {
          uid,
          txHash,
          status: "verified",
          chainId: BSC_CHAIN_ID,
          tokenContract,
          recipient: configuredRecipient,
          amountRaw: transfer.amountRaw.toString(),
          from: normalizeAddress(transaction.from),
          verifiedAt: now.toISOString(),
          confirmations,
          subscriptionEndsAt,
        });

        tx.set(
          accountRef,
          {
            plan: "premium",
            planName: "Premium",
            trialActive: false,
            accessLocked: false,
            subscriptionStartedAt: now.toISOString(),
            subscriptionEndsAt,
            lastPaymentTxHash: txHash,
            updatedAt: now.toISOString(),
          },
          { merge: true },
        );
      });

      return json(res, 200, {
        ok: true,
        data: {
          plan: "premium",
          planName: "Premium",
          subscriptionEndsAt,
          days: PREMIUM_DAYS,
        },
      });
    } catch (error) {
      if (error.message === "TX_ALREADY_USED") {
        return json(res, 409, {
          ok: false,
          error: "This transaction has already been used",
          code: "TX_ALREADY_USED",
        });
      }

      console.error("❌ Payment verification failed:", error.stack || error);
      return json(res, 500, {
        ok: false,
        error: "Payment verification failed",
        code: "PAYMENT_VERIFICATION_FAILED",
      });
    }
  });
}

module.exports = { paymentRoutes };
