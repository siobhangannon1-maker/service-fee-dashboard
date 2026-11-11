type StatementChargeInput = {
  serviceFeeExGst?: number;
  labMaterialsExGst?: number;
  hummFeesExGst?: number;
  patientFeesPaidToFocusNoGst?: number;
  patientFeesReceivedInErrorNoGst?: number;
  patientFeesPaidToAnotherProviderNoGst?: number;
  ivFacilityFeesNoGst?: number;
};

// Match the active Xero route's existing two-decimal line-amount rounding.
function money(value: number | undefined) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) throw new Error("Invalid statement charge amount.");
  return Math.round(amount * 100) / 100;
}

function gstOnLine(amount: number) {
  // Work from the rounded line's integer cents: 1.15 * 0.1 can otherwise
  // become 0.114999..., incorrectly dropping a cent from the PDF's GST.
  return Math.round(Math.round(amount * 100) / 10) / 100;
}

/** Final invoice charges only. Fee-base deductions and provider rates stay upstream.
 * Afterpay is intentionally absent: it is deducted from gross, never reimbursed.
 * The existing humm_fee amount includes the practice-paid Zip Money/Humm fees.
 */
export function calculateStatementCharges(input: StatementChargeInput) {
  const serviceFeeExGst = money(input.serviceFeeExGst);
  const labMaterialsExGst = money(input.labMaterialsExGst);
  const hummFeesExGst = money(input.hummFeesExGst);
  const serviceFeeGst = gstOnLine(serviceFeeExGst);
  const labMaterialsGst = gstOnLine(labMaterialsExGst);
  const hummFeesGst = gstOnLine(hummFeesExGst);
  const totalGst = money(serviceFeeGst + labMaterialsGst + hummFeesGst);
  const feesAndCostsTotalIncGst = money(
    serviceFeeExGst + labMaterialsExGst + hummFeesExGst + totalGst,
  );
  const finalTotalDue = money(
    feesAndCostsTotalIncGst +
      money(-Number(input.patientFeesPaidToFocusNoGst || 0)) +
      money(-Number(input.patientFeesPaidToAnotherProviderNoGst || 0)) +
      money(input.patientFeesReceivedInErrorNoGst) +
      money(input.ivFacilityFeesNoGst),
  );
  return {
    serviceFeeExGst,
    serviceFeeGst,
    serviceFeeIncGst: money(serviceFeeExGst + serviceFeeGst),
    labMaterialsExGst,
    labMaterialsGst,
    hummFeesExGst,
    hummFeesGst,
    afterpayFeesGst: 0,
    totalGst,
    feesAndCostsTotalIncGst,
    finalTotalDue,
  };
}
