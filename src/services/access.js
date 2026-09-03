const TRIAL_DAYS = 3;
const PREMIUM_DAYS = 30;

function toDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "object" && typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }

  if (typeof value === "object" && Number.isFinite(value._seconds)) {
    const date = new Date(value._seconds * 1000 + (Number(value._nanoseconds || 0) / 1e6));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  const base = toDate(date);
  if (!base) return null;

  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function resolveTrialExpiry(account) {
  const startedAt = toDate(account?.trialStartedAt);
  const storedEndsAt = toDate(account?.trialEndsAt);
  const calculatedEndsAt = startedAt ? addDays(startedAt, TRIAL_DAYS) : null;

  // trialStartedAt is the canonical start of the free trial. If an older or
  // malformed trialEndsAt says the trial is already expired while the
  // canonical 3-day window is still active, use the canonical expiry instead.
  // When both values are valid, never shorten the canonical trial window.
  if (calculatedEndsAt && storedEndsAt) {
    return new Date(Math.max(calculatedEndsAt.getTime(), storedEndsAt.getTime()));
  }

  return calculatedEndsAt || storedEndsAt;
}

function getAccessState(account) {
  const now = new Date();

  if (!account) {
    return {
      hasAccess: false,
      accessLocked: true,
      status: "NO_ACCOUNT",
      plan: "free",
      expiresAt: null,
    };
  }

  if (account.plan === "premium" && account.subscriptionEndsAt) {
    const expiresAt = toDate(account.subscriptionEndsAt);

    if (expiresAt && expiresAt > now) {
      return {
        hasAccess: true,
        accessLocked: false,
        status: "PREMIUM_ACTIVE",
        plan: "premium",
        expiresAt: expiresAt.toISOString(),
      };
    }

    return {
      hasAccess: false,
      accessLocked: true,
      status: expiresAt ? "PREMIUM_EXPIRED" : "PREMIUM_INVALID_EXPIRY",
      plan: "premium",
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    };
  }

  if (account.trialStartedAt || account.trialEndsAt) {
    const trialEndsAt = resolveTrialExpiry(account);

    if (trialEndsAt && trialEndsAt > now) {
      return {
        hasAccess: true,
        accessLocked: false,
        status: "TRIAL_ACTIVE",
        plan: "free",
        expiresAt: trialEndsAt.toISOString(),
      };
    }

    return {
      hasAccess: false,
      accessLocked: true,
      status: trialEndsAt ? "TRIAL_EXPIRED" : "TRIAL_INVALID_EXPIRY",
      plan: "free",
      expiresAt: trialEndsAt ? trialEndsAt.toISOString() : null,
    };
  }

  return {
    hasAccess: false,
    accessLocked: true,
    status: "NO_ACTIVE_ACCESS",
    plan: account.plan || "free",
    expiresAt: null,
  };
}

module.exports = {
  TRIAL_DAYS,
  PREMIUM_DAYS,
  addDays,
  getAccessState,
};
