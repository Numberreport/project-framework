export const POSITION_LIMIT = Number.MAX_SAFE_INTEGER;
// Stable display IDs only; connections continue to use $self plus the port.
export const boundaryId = (side, port) => (side === 'out' ? '$input:' : '$output:') + port;
export const endpointId = (end, side) => end.module === '$self' ? boundaryId(side, end.port) : end.module;
export function displayIds(children, inputs, outputs, edges = []) {
  const ins = new Set(inputs.map(p => p.name)), outs = new Set(outputs.map(p => p.name));
  for (const e of edges) {
    if (e.from.module === '$self') ins.add(e.from.port);
    if (e.to.module === '$self') outs.add(e.to.port);
  }
  return [...[...ins].map(p => boundaryId('out', p)), ...children, ...[...outs].map(p => boundaryId('in', p))];
}
// Keep saved positions; legacy aggregate cards are anchors, never shared positions.
export function initialPositions(ids, edges, saved = {}) {
  const defaults = arrange(ids, edges), result = {};
  for (const id of ids) if (saved[id]) result[id] = { ...saved[id] };
  for (const id of ids) if (!result[id]) {
    const prefix = id.startsWith('$input:') ? '$input' : id.startsWith('$output:') ? '$output' : null;
    const p = { ...(prefix && saved[prefix] || defaults[id]) };
    while (Object.values(result).some(q => Math.abs(q.x - p.x) < 245 && Math.abs(q.y - p.y) < 520)) p.y += 520;
    result[id] = p;
  }
  return result;
}
// Layout is display-only. Strongly connected nodes share a column.
export function arrange(ids, edges, heights = {}, widths = {}) {
  const next = new Map(ids.map(id => [id, []]));
  for (const e of edges) {
    const a = e.from.module === '$self' && next.has('$input') ? '$input' : endpointId(e.from, 'out');
    const b = e.to.module === '$self' && next.has('$output') ? '$output' : endpointId(e.to, 'in');
    if (next.has(a) && next.has(b)) next.get(a).push(b);
  }
  const reach = id => { const seen = new Set(); const visit = n => { if (seen.has(n)) return; seen.add(n); next.get(n).forEach(visit); }; visit(id); return seen; };
  const reachable = new Map(ids.map(id => [id, reach(id)])), groups = [], owner = new Map();
  for (const id of ids) if (!owner.has(id)) {
    const members = ids.filter(n => reachable.get(id).has(n) && reachable.get(n).has(id));
    members.forEach(n => owner.set(n, groups.length)); groups.push(members);
  }
  const ranks = groups.map(() => 0);
  for (let pass = 0; pass < groups.length; pass++) for (const [a, targets] of next) for (const b of targets) {
    const x = owner.get(a), y = owner.get(b); if (x !== y) ranks[y] = Math.max(ranks[y], ranks[x] + 1);
  }
  if (ids.some(id => id.startsWith('$input:') || id.startsWith('$output:'))) {
    const last = Math.max(0, ...ranks) + 2;
    groups.forEach((members, i) => { ranks[i] = members[0].startsWith('$input:') ? 0 : members[0].startsWith('$output:') ? last : ranks[i] + 1; });
  }
  const columns = [];
  groups.forEach((members, i) => { columns[ranks[i]] = Math.max(columns[ranks[i]] || 245, ...members.map(id => widths[id] || 245)); });
  const offsets = []; let x = 40;
  columns.forEach((width, rank) => { offsets[rank] = x; x += width + 95; });
  const bottoms = new Map(), positions = {};
  groups.forEach((members, i) => members.forEach(id => {
    const rank = ranks[i], y = bottoms.get(rank) || 60;
    positions[id] = { x: offsets[rank], y };
    bottoms.set(rank, y + (heights[id] || 460) + 60);
  }));
  return positions;
}
