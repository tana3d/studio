// Opt-in end-to-end check in the actual app: catalog search, download, local conversion, placement.
(async()=>{
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let report={};
 const invoke=window.__TAURI__.core.invoke;
 try{
  if(document.getElementById('catalog-grid')){
   for(let i=0;i<100&&!window.studioCatalog;i++)await wait(100);
   const search=document.getElementById('catalog-search');search.value='Textured conversion check';search.dispatchEvent(new Event('input'));
   let card;for(let i=0;i<200;i++){card=[...document.querySelectorAll('.catalog-card')].find(c=>c.querySelector('h3')?.textContent==='Textured conversion check');if(card&&document.querySelectorAll('.catalog-card').length===1&&document.getElementById('catalog-grid').getAttribute('aria-busy')==='false')break;await wait(100);}
   if(!card)throw Error('Textured conversion check search did not render.');
   const button=card.querySelector('button'),bar=card.querySelector('progress'),stages=[];let determinate=false,indeterminate=false;
   const observer=new MutationObserver(()=>{if(!bar.hidden){const label=card.querySelector('.catalog-progress-label').textContent;stages.push(label);if(bar.hasAttribute('value'))determinate=true;else if(label.includes('Converting'))indeterminate=true;}});
   observer.observe(card,{subtree:true,childList:true,attributes:true,characterData:true});button.click();
   for(let i=0;i<1800&&(!window.studioCatalog.saved.has(card.dataset.asset)||!bar.hidden);i++)await wait(200);
   observer.disconnect();if(!window.studioCatalog.saved.has(card.dataset.asset))throw Error(card.querySelector('.catalog-progress-label').textContent);
   report={ok:true,catalog:true,determinate,indeterminate,stages:[...new Set(stages)],id:card.dataset.asset,barHidden:bar.hidden,button:button.textContent};
   if(!determinate||!indeterminate||!bar.hidden)throw Error('Download and conversion progress checks failed.');
   await invoke('native_smoke_report',{kind:'package',report});
  }else if(document.querySelector('iframe')){
   let frame;for(let i=0;i<200;i++){frame=document.querySelector('iframe')?.contentWindow;if(frame?.__studio?.ready&&frame.__studio.library)break;await wait(200);}
   if(!frame?.__studio?.library)throw Error('Editor did not initialize.');
   const before=await invoke('library_list');if(before.assets.some(a=>a.name==='Textured conversion check'))throw Error('Textured conversion check already saved; this test needs a new catalog download.');
   await invoke('library_open_browser');
   let item;for(let i=0;i<1800;i++){item=[...frame.__studio.library.saved.values()].find(a=>a.name==='Textured conversion check');if(item)break;await wait(200);}
   if(!item)throw Error('Converted Textured conversion check did not appear in the editor library.');
   const placed=await frame.__studio.rixse.dispatch({type:'place_asset',payload:{asset_id:item.id,anchor:'camera_foreground'}},'you');if(!placed.ok)throw Error(placed.error);
   let meshes=0,textures=0;frame.__studio.scene.children.find(o=>o.userData.objectId===placed.id)?.traverse(o=>{if(o.isMesh){meshes++;for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.map)textures++;}});
   if(!meshes||!textures)throw Error('Placed model has no visible textured meshes.');
   await invoke('native_smoke_report',{kind:'package',report:{ok:true,placement:true,id:item.id,meshes,textures,animations:item.animations}});
  }
 }catch(error){await invoke('native_smoke_report',{kind:'package',report:{...report,ok:false,error:String(error)}});}
})();
