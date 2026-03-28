export function emaStep(prev: number | null, value: number, alpha: number): number {
  if (!(alpha > 0 && alpha <= 1)) throw new Error(`alpha must be in (0,1], got ${alpha}`);
  if (prev === null) return value;
  return alpha * value + (1 - alpha) * prev;
}
