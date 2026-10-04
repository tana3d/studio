const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

// Exact coordinates are never silently changed. Named locations can find a
// nearby clear spot; the actual position is returned to the model.
export function resolvePlacement(placement, anchors, clear) {
  if (!placement || typeof placement !== 'object') throw new Error('Provide a placement.');
  const offset = placement.offset ?? [0, 0, 0];
  if (!vector(offset) || offset.some(v => Math.abs(v) > 50)) throw new Error('Offset must be three finite metres, within 50 metres.');
  if (placement.anchor != null) {
    if (typeof placement.anchor !== 'string' || !Object.hasOwn(anchors, placement.anchor)) throw new Error('Unknown location. Read the current scene anchors.');
    if (placement.position != null) throw new Error('Choose an anchor or exact coordinates, not both.');
    const desired = anchors[placement.anchor].position.map((v, i) => v + offset[i]);
    for (let ring = 0; ring <= 6; ring++) {
      for (let n = 0; n < (ring ? 16 : 1); n++) {
        const angle = n * Math.PI / 8;
        const position = [desired[0] + Math.cos(angle) * ring * .5, desired[1], desired[2] + Math.sin(angle) * ring * .5];
        if (clear(position)) return { position, adjusted: ring > 0 };
      }
    }
    throw new Error('No clear spot within three metres of that location. Choose another anchor or coordinates.');
  }
  if (!vector(placement.position)) throw new Error('Position must be [x, y, z] in metres.');
  const position = placement.position.map((v, i) => v + offset[i]);
  if (!clear(position)) throw new Error('That position is outside the alley or overlaps an object or character. Use find_placements for a clear spot.');
  return { position, adjusted: false };
}
