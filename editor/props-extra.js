import * as THREE from 'three';

export const extraAssets = [
  { id:'bench', name:'Park bench', icon:'⊓', detail:'Wood & steel', size:[1.8,.65], height:1 },
  { id:'table', name:'Café table', icon:'⊤', detail:'Round metal table', size:[1,1], height:.8 },
  { id:'chair', name:'Café chair', icon:'⑁', detail:'Slatted wood', size:[.55,.6], height:1 },
  { id:'barrel', name:'Steel barrel', icon:'▥', detail:'Industrial prop', size:[.65,.65], height:.95 },
  { id:'cone', name:'Traffic cone', icon:'△', detail:'Safety marker', size:[.45,.45], height:.7 },
  { id:'barrier', name:'Road barrier', icon:'▰', detail:'Concrete divider', size:[2,.6], height:.9 },
  { id:'planter', name:'Planter', icon:'♧', detail:'Potted shrub', size:[.8,.8], height:1.3 },
  { id:'tree', name:'Street tree', icon:'♠', detail:'Leafy canopy', size:[.7,.7], height:3.8 },
  { id:'hedge', name:'Hedge', icon:'▩', detail:'Garden divider', size:[1.8,.6], height:1.25 },
  { id:'bollard', name:'Bollard', icon:'Ⅰ', detail:'Street marker', size:[.25,.25], height:.9 },
  { id:'pallet', name:'Wooden pallet', icon:'▤', detail:'Stackable platform', size:[1.2,1], height:.18 },
  { id:'fence', name:'Wooden fence', icon:'▥', detail:'Set boundary', size:[2,.2], height:1.4 },
  { id:'rock', name:'Boulder', icon:'⬡', detail:'Garden rock', size:[.9,.8], height:.7 },
  { id:'bin', name:'Trash bin', icon:'▥', detail:'Street furniture', size:[.55,.55], height:.9 },
];
export function buildExtra(parent, spec) {
  const group = new THREE.Group(); group.position.set(...spec.position); parent.add(group);
  const wood = new THREE.MeshStandardMaterial({color:0x866348,roughness:.85});
  const metal = new THREE.MeshStandardMaterial({color:0x354146,metalness:.55,roughness:.5});
  const leaf = new THREE.MeshStandardMaterial({color:0x41634c,roughness:.9});
  const orange = new THREE.MeshStandardMaterial({color:0xdf6a2a,roughness:.7});
  const white = new THREE.MeshStandardMaterial({color:0xd4d8cd,roughness:.8});
  const add=(geo,mat,x,y,z)=> { const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;group.add(m);return m; };
  const box=(w,h,d,x,y,z,mat=wood)=>add(new THREE.BoxGeometry(w,h,d),mat,x,y,z);
  const cyl=(r,h,x,y,z,mat=metal)=>add(new THREE.CylinderGeometry(r,r,h,16),mat,x,y,z);
  const shrub=(r,x,y,z)=>add(new THREE.IcosahedronGeometry(r,1),leaf,x,y,z);
  switch(spec.type) {
    case 'bench':
      for(const z of [-.22,0,.22]) box(1.8,.07,.18,0,.48,z);
      for(const y of [.72,.94]) box(1.8,.15,.06,0,y,-.28);
      for(const x of [-.68,.68]) { box(.09,.95,.09,x,.48,-.28,metal);box(.09,.48,.5,x,.24,0,metal); } break;
    case 'table': cyl(.5,.06,0,.77,0);cyl(.05,.72,0,.36,0);cyl(.3,.07,0,.035,0);break;
    case 'chair': box(.5,.07,.5,0,.48,0);for(const x of [-.21,.21])for(const z of [-.21,.21])box(.055,.48,.055,x,.24,z,metal);for(const x of [-.21,.21])box(.055,.5,.055,x,.75,-.21,metal);for(const y of [.7,.9])box(.5,.14,.05,0,y,-.21);break;
    case 'barrel': cyl(.32,.9,0,.45,0,orange);for(const y of [.08,.45,.83])cyl(.334,.045,0,y,0);break;
    case 'cone':box(.45,.05,.45,0,.025,0,metal);add(new THREE.ConeGeometry(.18,.65,16),orange,0,.375,0);add(new THREE.CylinderGeometry(.072,.1,.1,16),white,0,.43,0);break;
    case 'barrier':box(2,.25,.6,0,.125,0,white);box(2,.65,.32,0,.575,0,white);for(const x of [-.7,0,.7])box(.22,.12,.34,x,.68,0,orange);break;
    case 'planter':box(.8,.55,.8,0,.275,0,wood);shrub(.55,0,.8,0);break;
    case 'tree':cyl(.12,2.3,0,1.15,0,wood);shrub(.95,0,2.8,0);shrub(.6,.55,2.5,.15);shrub(.55,-.55,2.6,-.15);break;
    case 'hedge':box(1.8,.25,.6,0,.125,0,wood);box(1.75,1,.58,0,.75,0,leaf);break;
    case 'bollard':cyl(.12,.9,0,.45,0);cyl(.125,.1,0,.75,0,white);break;
    case 'pallet':for(const x of [-.45,0,.45])box(.13,.13,1,x,.065,0);for(const z of [-.42,-.21,0,.21,.42])box(1.2,.05,.16,0,.155,z);break;
    case 'fence':for(const x of [-.9,0,.9])box(.08,1.4,.08,x,.7,0);for(const y of [.3,.8,1.25])box(2,.16,.07,0,y,0);break;
    case 'rock': {const m=add(new THREE.IcosahedronGeometry(.5,1),new THREE.MeshStandardMaterial({color:0x707774,roughness:1}),0,.3,0);m.scale.set(1,.8,.9);break;}
    case 'bin':cyl(.27,.85,0,.425,0);cyl(.29,.05,0,.875,0);break;
  }
}
