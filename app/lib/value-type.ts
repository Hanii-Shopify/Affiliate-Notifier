export type ValueType = "PERCENTAGE" | "FIXED_AMOUNT";

export function formatValue(type: ValueType, value: number): string {
  return type === "PERCENTAGE" ? `${value}%` : `$${value.toFixed(2)}`;
}

export function calculateAmount(
  type: ValueType,
  value: number,
  base: number,
): number {
  return type === "PERCENTAGE" ? (base * value) / 100 : value;
}
