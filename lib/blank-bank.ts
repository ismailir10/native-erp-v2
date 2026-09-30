/**
 * A bank-account row nobody filled in — no number, no name, not marked PRK. The new-client form starts with one such row, so
 * saving without touching it means "no bank account", not an error. The bank picker has a default, so it doesn't count.
 */
export const isBlankBankRow = (b: { number: string; label: string; isOverdraft?: boolean }) => !b.number.trim() && !b.label.trim() && !b.isOverdraft;
