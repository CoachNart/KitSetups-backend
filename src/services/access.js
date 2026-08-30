const TRIAL_DAYS = 3;
const PREMIUM_DAYS = 30;

function addDays(date, days) {
  return new Date(
    new Date(date).getTime() + days * 24 * 60 * 60 * 1000
  );
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

  if (
    account.plan === "premium" &&
    account.subscriptionEndsAt
  ) {
    const expiresAt = new Date(account.subscriptionEndsAt);

    if (expiresAt > now) {
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
      status: "PREMIUM_EXPIRED",
      plan: "premium",
      expiresAt: expiresAt.toISOString(),
    };
  }

  if (account.trialStartedAt) {
    const trialEndsAt =
      account.trialEndsAt ||
      addDays(account.trialStartedAt, TRIAL_DAYS);

    const expiresAt = new Date(trialEndsAt);

    if (expiresAt > now) {
      return {
        hasAccess: true,
        accessLocked: false,
        status: "TRIAL_ACTIVE",
        plan: "free",
        expiresAt: expiresAt.toISOString(),
      };
    }

    return {
      hasAccess: false,
      accessLocked: true,
      status: "TRIAL_EXPIRED",
      plan: "free",
      expiresAt: expiresAt.toISOString(),
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
