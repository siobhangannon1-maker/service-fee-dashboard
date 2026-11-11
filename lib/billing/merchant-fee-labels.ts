// Display only: historical humm_fee records continue to use their existing ID.
export const ZIP_MONEY_HUMM_FEES_LABEL = "Zip Money and Humm fees";

export function merchantFeeCategoryLabel(category: string): string {
  if (category === "humm_fee") return ZIP_MONEY_HUMM_FEES_LABEL;
  if (category === "afterpay_fee") return "Afterpay Merchant Fee";
  if (category === "incorrect_payment") return "Incorrect Payment";
  return category;
}
