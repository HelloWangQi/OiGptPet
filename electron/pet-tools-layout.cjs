function expandedToolsLayout(base, area) {
  const gap = 12;
  const toolsWidth = Math.min(288, Math.max(160, area.width - base.width - gap));
  const extra = gap + toolsWidth;
  const rightRoom = area.x + area.width - base.x - base.width;
  const leftRoom = base.x - area.x;
  const left = rightRoom < extra && leftRoom > rightRoom;
  const width = base.width + extra;
  const x = Math.max(area.x, Math.min(left ? base.x - extra : base.x, area.x + area.width - width));
  return {
    bounds: { ...base, x, width },
    layout: { open: true, petWidth: base.width, petLeft: left ? extra : 0, toolsLeft: left ? 0 : base.width + gap, toolsWidth },
  };
}
module.exports = { expandedToolsLayout };
