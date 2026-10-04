import * as THREE from 'three';
// Blend rendered views so preview and exported footage use the same pixels.
export class CameraTransitions {
  constructor(renderer){
    this.renderer=renderer;this.size=new THREE.Vector2();
    this.a=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType});
    this.b=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType});
    this.material=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{a:{value:this.a.texture},b:{value:this.b.texture},progress:{value:0},wipe:{value:false}},
      vertexShader:'varying vec2 uvPos; void main(){uvPos=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:`uniform sampler2D a;uniform sampler2D b;uniform float progress;uniform bool wipe;varying vec2 uvPos;
      void main(){float blend=wipe?step(uvPos.x,progress):progress;gl_FragColor=mix(texture2D(a,uvPos),texture2D(b,uvPos),blend);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`});
    this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.material));this.camera=new THREE.Camera();
  }
  render(scene,incoming,outgoing,transition,progress){
    const r=this.renderer;
    if(!outgoing){r.render(scene,incoming);return;}
    r.getDrawingBufferSize(this.size);
    for(const target of [this.a,this.b])if(target.width!==this.size.x||target.height!==this.size.y)target.setSize(this.size.x,this.size.y);
    const prior=r.getRenderTarget();
    r.setRenderTarget(this.a);r.render(scene,outgoing);
    r.setRenderTarget(this.b);r.render(scene,incoming);
    r.setRenderTarget(prior);this.material.uniforms.progress.value=progress;this.material.uniforms.wipe.value=transition==='Wipe';r.render(this.scene,this.camera);
  }
}
