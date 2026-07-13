import type { Vec2 } from '../interaction/coords';

// 2D減衰スプリング（semi-implicit Euler）。呼び出し側でサブステップ分割する前提。
export function stepSpring(
  p: Vec2,
  v: Vec2,
  targetX: number,
  targetY: number,
  omega: number,
  zeta: number,
  dt: number,
): void {
  const ax = omega * omega * (targetX - p.x) - 2 * zeta * omega * v.x;
  const ay = omega * omega * (targetY - p.y) - 2 * zeta * omega * v.y;
  v.x += ax * dt;
  v.y += ay * dt;
  p.x += v.x * dt;
  p.y += v.y * dt;
}
