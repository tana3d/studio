// Opt-in debug test of actual WebKit, packaged Python, ZIP and persistent library.
(async()=>{
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));const report={};
  try{
    let frame;
    for(let i=0;i<200;i++){frame=document.querySelector('iframe')?.contentWindow;if(frame?.__studio?.ready&&frame.__studio.library)break;await wait(200);}
    if(!frame?.__studio?.library)throw new Error('Editor did not initialize.');
    const doc=frame.document;doc.getElementById('library-tab').click();
    const stages=[];const panel=doc.getElementById('import-progress-panel');
    const observer=new MutationObserver(()=>{if(!panel.hidden)stages.push(doc.getElementById('import-status').textContent);});
    observer.observe(panel,{subtree:true,childList:true,attributes:true,characterData:true});
    doc.getElementById('import-model').click();
    report.progressVisible=!panel.hidden;report.indeterminate=!doc.getElementById('import-progress').hasAttribute('value');
    report.busyButton=doc.getElementById('import-model').disabled;
    for(let i=0;i<600&&!panel.hidden;i++)await wait(200);
    observer.disconnect();report.stages=[...new Set(stages)];
    const saved=await window.__TAURI__.core.invoke('library_list');report.root=saved.root;
    report.hint=doc.getElementById('hint').textContent;report.toast=doc.getElementById('toast').textContent;
    const item=saved.assets.find(a=>a.name==='textured');if(!item)throw new Error('Converted asset was not saved.');
    report.id=item.id;report.animations=item.animations;
    const placed=await frame.__studio.rixse.dispatch({type:'place_asset',payload:{asset_id:item.id,anchor:'camera_foreground'}},'you');
    if(!placed.ok)throw new Error(placed.error);
    let meshes=0,textures=0;frame.__studio.scene.children.find(o=>o.userData.objectId===placed.id)?.traverse(o=>{if(o.isMesh){meshes++;for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.map)textures++;}});
    report.meshes=meshes;report.textures=textures;report.progressHidden=panel.hidden;
    if(!report.progressVisible||!report.indeterminate||!report.busyButton||!report.progressHidden||!meshes||!textures||!item.animations.length||!stages.some(s=>s.includes('Converting')))throw new Error('Conversion progress, texture or animation check failed.');
    doc.getElementById('import-model').click();
    for(let i=0;i<100&&!doc.getElementById('import-status').textContent.includes('Converting');i++)await wait(10);
    doc.getElementById('cancel-import').click();
    for(let i=0;i<100&&!panel.hidden;i++)await wait(50);
    report.cancelled=panel.hidden&&doc.getElementById('toast').textContent.includes('cancelled');
    if(!report.cancelled)throw new Error('Cancelling conversion did not stop the import.');
    report.ok=true;
  }catch(error){report.ok=false;report.error=String(error);}
  await window.__TAURI__.core.invoke('native_smoke_report',{kind:'import',report});
})();
