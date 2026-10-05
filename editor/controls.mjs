export const damping = (rate, dt) => -Math.expm1(-rate * Math.max(0, dt));
export function movementIntent(forward, side, yaw, speed) {
  const length = Math.hypot(forward, side);
  if (!length) return { x: 0, z: 0 };
  return { x: (-Math.sin(yaw)*forward + Math.cos(yaw)*side)*speed/length,
    z: (-Math.cos(yaw)*forward - Math.sin(yaw)*side)*speed/length };
}
export function turnToward(current, target, dt) {
  const delta = Math.atan2(Math.sin(target-current), Math.cos(target-current));
  return current + delta*damping(16,dt);
}
export function controlShortcut(event) {
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return null;
  if (event.code === 'Backquote') return { type: 'character' };
  if (/^Digit[1-9]$/.test(event.code)) return { type: 'camera', index: Number(event.code.slice(-1))-2 };
  return null;
}
export function jumpStep(y, velocity, floor, scale, dt) {
  const gravity=16*scale;
  const height=y+velocity*dt-.5*gravity*dt*dt;
  return height<=floor&&velocity<=0?{y:floor,velocity:0,landed:true}:{y:height,velocity:velocity-gravity*dt,landed:false};
}

// A round footprint slides along walls and around prop corners. Small swept
// steps prevent walking through thin props when a frame arrives late.
export function slideCharacter(position, displacement, radius, bounds, colliders, height) {
  const result = { x:position.x, z:position.z };
  const steps = Math.max(1,Math.ceil(Math.hypot(displacement.x,displacement.z)/(radius*.4)));
  for (let step=0;step<steps;step++) {
    result.x += displacement.x/steps; result.z += displacement.z/steps;
    for (let iteration=0;iteration<4;iteration++) {
      result.x = Math.max(bounds[0][0]+radius,Math.min(bounds[1][0]-radius,result.x));
      result.z = Math.max(bounds[0][1]+radius,Math.min(bounds[1][1]-radius,result.z));
      let pushed=false;
      for (const c of colliders) {
        if (position.y >= c.y+c.h-1e-6 || position.y+height <= c.y+1e-6) continue;
        const x=Math.max(c.minX,Math.min(c.maxX,result.x)), z=Math.max(c.minZ,Math.min(c.maxZ,result.z));
        const dx=result.x-x,dz=result.z-z,distance=Math.hypot(dx,dz);
        if (distance >= radius) continue;
        if (distance > 1e-8) {
          const push=(radius-distance)/distance; result.x+=dx*push;result.z+=dz*push;
        } else {
          const edges=[{distance:result.x-c.minX,x:c.minX-radius,z:result.z}, {distance:c.maxX-result.x,x:c.maxX+radius,z:result.z},
            {distance:result.z-c.minZ,x:result.x,z:c.minZ-radius}, {distance:c.maxZ-result.z,x:result.x,z:c.maxZ+radius}];
          const edge=edges.reduce((a,b)=>a.distance<b.distance?a:b);result.x=edge.x;result.z=edge.z;
        }
        pushed=true;
      }
      if (!pushed) break;
    }
  }
  return result;
}
