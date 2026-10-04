// Observe the catalog after a real OS URL-open event; never simulate the download click.
(async()=>{
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let report={};
 try{
  for(let i=0;i<200&&!window.studioCatalog;i++)await wait(100);
  const id='4603a6cd-1567-4a22-947e-ff2f43ab4e19';let card;
  for(let i=0;i<1800;i++){
   card=document.querySelector(`[data-asset="${id}"]`);
   if(card&&window.studioCatalog.saved.has(id)&&document.getElementById('catalog-status').textContent==='Ammo Box added to your collection.')break;
   await wait(200);
  }
  if(!card||document.getElementById('catalog-status').textContent!=='Ammo Box added to your collection.')throw Error('The OS link did not automatically add the requested asset.');
  report={ok:true,id,search:document.getElementById('catalog-search').value,card:card.querySelector('h3').textContent,status:document.getElementById('catalog-status').textContent,button:card.querySelector('button').textContent};
 }catch(error){report={ok:false,error:String(error)};}
 await window.__TAURI__.core.invoke('native_smoke_report',{kind:'link',report});
 if(report.ok)await window.__TAURI__.core.invoke('library_close_browser');
})();
