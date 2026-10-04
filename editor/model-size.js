import { Box3 } from 'three';
export function modelScale(value) {
  if(!Number.isFinite(value)||value<=0)throw new Error('Choose a positive model size.');
  return value;
}
// Keep a prop's bottom at its existing height, even when a set piece has a
// centre pivot. Scale the instance group; its shared source geometry stays intact.
export function scaleModel(group,value,keepBottom=true) {
  modelScale(value);group.updateWorldMatrix(true,true);
  const bottom=new Box3().setFromObject(group).min.y;
  group.scale.setScalar(value);group.updateWorldMatrix(true,true);
  if(keepBottom){group.position.y+=bottom-new Box3().setFromObject(group).min.y;group.updateWorldMatrix(true,true);}
}
