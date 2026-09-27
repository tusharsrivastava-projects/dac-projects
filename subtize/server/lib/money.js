/** Everything is paise internally; these are the only places that convert. */

export const toRupees = (paise) => Math.round(Number(paise || 0)) / 100;

export function formatINR(paise) {
  const r = toRupees(paise);
  return `₹${r.toLocaleString('en-IN', { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** Splits a gross amount into the platform's share and the lister's. Commission rounds to the paisa. */
export function splitRevenue(gross, percent) {
  const commission = Math.round((gross * percent) / 100);
  return { gross, commission, payable: gross - commission, percent };
}
