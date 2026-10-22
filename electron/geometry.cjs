function fitBounds(saved, workArea, defaults) {
  const safe = saved && typeof saved === 'object' ? saved : {};
  const number = (value, fallback) => Number.isFinite(value) ? Math.round(value) : fallback;
  const width = Math.min(workArea.width, Math.max(240, number(safe.width, defaults.width)));
  const height = Math.min(workArea.height, Math.max(320, number(safe.height, defaults.height)));
  return {
    x: Math.min(workArea.x + workArea.width - width, Math.max(workArea.x, number(safe.x, workArea.x + workArea.width - width - 30))),
    y: Math.min(workArea.y + workArea.height - height, Math.max(workArea.y, number(safe.y, workArea.y + workArea.height - height - 30))),
    width, height,
  };
}
module.exports = { fitBounds };
