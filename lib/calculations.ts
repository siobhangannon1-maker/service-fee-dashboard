export function calculateTieredServiceFee(
  feeBase: number,
  tiers: { up_to: number | null; rate: number }[]
) {
  let remaining = feeBase;
  let previousLimit = 0;
  let total = 0;

  for (const tier of tiers) {
    if (remaining <= 0) break;

    if (tier.up_to === null) {
      total += remaining * (tier.rate / 100);
      break;
    }

    const bandSize = tier.up_to - previousLimit;
    const amountInBand = Math.min(remaining, bandSize);

    if (amountInBand > 0) {
      total += amountInBand * (tier.rate / 100);
      remaining -= amountInBand;
    }

    previousLimit = tier.up_to;
  }

  return total;
}

export function calculateServiceFee(
  provider: {
    service_fee_type: "flat" | "tiered";
    service_fee_percent: number;
    tier_config: { up_to: number | null; rate: number }[] | null;
  },
  feeBase: number
) {
  if (provider.service_fee_type === "tiered" && provider.tier_config) {
    return calculateTieredServiceFee(feeBase, provider.tier_config);
  }

  return feeBase * ((provider.service_fee_percent || 0) / 100);
}