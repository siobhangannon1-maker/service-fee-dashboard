type Tier = {
  up_to: number | null;
  rate: number;
};

type Provider = {
  name: string;
  service_fee_type: "flat" | "tiered";
  service_fee_percent: number;
  tier_config: Tier[] | null;
};

type BreakdownLine = {
  label: string;
  amount: number;
};

function money(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildServiceFeeBreakdown(
  provider: Provider,
  feeBase: number
): BreakdownLine[] {
  if (provider.service_fee_type === "flat") {
    const amount = feeBase * (provider.service_fee_percent / 100);

    return [
      {
        label: `${provider.service_fee_percent}% service fee on net patient fees`,
        amount: money(amount),
      },
    ];
  }

  const tiers = provider.tier_config || [];

  let remaining = feeBase;
  let previousLimit = 0;

  const lines: BreakdownLine[] = [];

  for (const tier of tiers) {
    if (remaining <= 0) break;

    const currentLimit =
      tier.up_to === null ? Infinity : tier.up_to;

    const tierRange = currentLimit - previousLimit;

    const applicableAmount =
      tier.up_to === null
        ? remaining
        : Math.min(remaining, tierRange);

    const fee = applicableAmount * (tier.rate / 100);

    if (tier.up_to === null) {
      lines.push({
        label: `${tier.rate}% service fee on remaining net patient fees`,
        amount: money(fee),
      });
    } else {
      lines.push({
        label: `${tier.rate}% service fee on first $${currentLimit.toLocaleString(
          "en-AU"
        )}`,
        amount: money(fee),
      });
    }

    remaining -= applicableAmount;
    previousLimit = currentLimit;
  }

  return lines;
}