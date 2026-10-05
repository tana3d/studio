// Opt-in verification inside the actual macOS webview; always release capture.
(async()=>{
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let frame,report={};
  try{
    await window.__TAURI__.core.invoke('native_smoke_report',{kind:'controls',report:{phase:'loading'}});
    for(let i=0;i<200;i++){frame=document.querySelector('iframe')?.contentWindow;if(frame?.__studio?.ready)break;await wait(100);}
    if(!frame?.__studio?.ready)throw Error('Scene did not load.');
    const key=(code,modifiers={})=>frame.document.dispatchEvent(new frame.KeyboardEvent('keydown',{code,...modifiers,bubbles:true}));
    key('Digit1',{ctrlKey:true,shiftKey:true});key('Backquote',{ctrlKey:true,shiftKey:true});
    if(frame.__studio.controlMode!=='character')throw Error('Character shortcut failed.');
    const a=frame.__studio.actors.Vale;a.group.position.set(0,0,-16);a.velocity.set(0,0);
    key('Space');for(let i=0;i<30&&a.group.position.y<.2;i++)await wait(50);
    report.jumpHeight=a.group.position.y;
    for(let i=0;i<40&&a.jumpState;i++)await wait(50);
    report.landed=a.group.position.y===0&&!a.jumpState;
    const canvas=frame.__studio.renderer.domElement;
    canvas.click();for(let i=0;i<40&&!frame.__studio.mouseCaptured;i++)await wait(50);
    report.nativeMouseCaptured=frame.__studio.mouseCaptured;
    key('Digit3',{ctrlKey:true,shiftKey:true});
    report.cameraShortcut=frame.__studio.camIndex===1&&frame.__studio.controlMode==='camera';
    report.releasedOnSwitch=!frame.__studio.mouseCaptured;
    const fov=frame.__studio.camera.fov;
    canvas.dispatchEvent(new frame.WheelEvent('wheel',{deltaY:-400,bubbles:true,cancelable:true}));
    for(let i=0;i<60&&(frame.__studio.history.pending||frame.__studio.camera.fov===fov);i++)await wait(50);
    report.zoom=frame.__studio.camera.fov<fov;
    report.ok=report.jumpHeight>.2&&report.landed&&report.nativeMouseCaptured&&report.cameraShortcut&&report.releasedOnSwitch&&report.zoom;
  }catch(error){report.error=String(error);report.ok=false;}
  finally{
    await window.__TAURI__.core.invoke('studio_capture_mouse',{capture:false}).catch(()=>{});
    await window.__TAURI__.core.invoke('native_smoke_report',{kind:'controls',report});
  }
})();
