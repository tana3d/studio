// Actual WebKit + native filesystem/HTTP smoke. Opt-in debug build only.
(async()=>{
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let report={};
  try{
    let frame;
    for(let i=0;i<200;i++){frame=document.querySelector('iframe')?.contentWindow;if(frame?.__studio?.library)break;await wait(200);}
    if(!frame?.__studio?.library)throw new Error('The library did not initialize.');
    const invoke=window.__TAURI__.core.invoke;
    const initial=await invoke('library_list');
    let item=initial.assets.find(a=>a.catalog?.slug==='ukulele_01'||a.catalog?.slug==='ukulele-01');
    report.restoredInitially=!!item;report.initialCount=initial.assets.length;report.root=initial.root;
    if(!item){
      const catalog=await invoke('library_catalog',{q:'ukulele',category:'props',page:1});
      if(!catalog.assets?.length)throw new Error('The hosted catalog returned no ukulele.');
      item=await frame.__studio.library.download(catalog.assets[0].id);
    }else await frame.__studio.library.collect();
    report.savedId=item.id;report.name=item.name;report.catalog=item.catalog?.license;
    const result=await frame.__studio.rixse.dispatch({type:'place_asset',payload:{asset_id:item.id,anchor:'camera_foreground'}},'you');
    if(!result.ok)throw new Error(result.error);
    const model=frame.__studio.scene.children.find(g=>g.userData.objectId===result.id);
    report.meshes=0;model?.traverse(o=>{if(o.isMesh)report.meshes++;});
    if(!report.meshes)throw new Error('Downloaded model did not render.');
    report.placement=result.position;
    const saved=await invoke('library_list');report.savedCount=saved.assets.length;
    frame.document.getElementById('undo').click();await wait(100);
    report.undoRemoved=!frame.__scene.environment.props.some(p=>p.id===result.id);
    report.collectionAfterUndo=frame.__studio.library.saved.has(item.id);
    for(let i=0;i<30&&frame.document.getElementById('redo').disabled;i++)await wait(100);
    frame.document.getElementById('redo').click();await wait(100);report.redoRestored=frame.__scene.environment.props.some(p=>p.id===result.id);
    if(!report.undoRemoved||!report.redoRestored||!report.collectionAfterUndo)throw new Error('Collection undo/redo failed.');
    if(window.__TAURI__?.core){
      const before=new Set([...frame.__studio.library.saved.keys()]);
      await invoke('library_open_browser');
      for(let i=0;i<200&&![...frame.__studio.library.saved.keys()].some(id=>!before.has(id));i++)await wait(200);
      report.separateWindowUpdatedMain=[...frame.__studio.library.saved.keys()].some(id=>!before.has(id));
      if(!report.separateWindowUpdatedMain)throw new Error('Separate window download did not update main Library.');
    }
    await invoke('library_close_browser');await wait(500);
    const robot=await frame.__studio.rixse.dispatch({type:'place_asset',payload:{asset_id:'robot',x:1.8,y:0,z:2}},'you');
    if(!robot.ok)throw new Error(robot.error);
    frame.document.getElementById('record-performance').click();
    const gestures=frame.document.getElementById('gesture-select');gestures.value='Wave';gestures.dispatchEvent(new Event('change'));
    for(let i=0;i<150&&frame.__studio.timeline.time<1.5;i++)await wait(100);
    frame.document.getElementById('record-performance').click();
    const actor=frame.__studio.actors[robot.name],bones=()=>{let a=[];actor.group.traverse(o=>{if(o.isBone)a.push(...o.quaternion.toArray());});return JSON.stringify(a);};
    frame.__studio.timeline.seek(.4);const early=bones();frame.__studio.timeline.seek(.9);const later=bones();frame.__studio.timeline.seek(.4);
    report.emote={animation:'Wave',recordedFrames:frame.__studio.timeline.items.at(-1).frames.length,poseChanged:early!==later,rewindMatches:early===bones()};
    if(!report.emote.poseChanged||!report.emote.rewindMatches)throw new Error('Emote recording or seeking failed.');
    report.ok=true;
  }catch(error){report.ok=false;report.error=String(error);}
  await window.__TAURI__.core.invoke('native_smoke_report',{report});
})();
