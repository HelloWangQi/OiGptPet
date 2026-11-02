/** Screen-right maps to positive VRM yaw; sprite angles turn clockwise from up. */
export function pointerLook(clientX: number, clientY: number, bounds: { left: number; top: number; width: number; height: number }) {
  if (bounds.width <= 0 || bounds.height <= 0) return { yaw: 0, pitch: 0, angle: 0 };
  const x = clientX - bounds.left - bounds.width / 2;
  const y = clientY - bounds.top - bounds.height / 2;
  return {
    yaw: x / bounds.width * 0.7,
    pitch: y / bounds.height * 0.4,
    angle: (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360,
  };
}
