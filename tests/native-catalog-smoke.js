(async()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms));let report={};
 try{
  for(let i=0;i<100&&!window.studioCatalog;i++)await wait(100);
  if(!window.studioCatalog)throw Error('Catalog window did not initialize.');
  const invoke=window.__TAURI__.core.invoke;
  const before=await invoke('library_list'),ids=new Set(before.assets.map(a=>a.id));
  const category=document.getElementById('catalog-category');category.value='props';category.dispatchEvent(new Event('change'));
  for(let i=0;i<100&&document.getElementById('catalog-grid').getAttribute('aria-busy')!=='false';i++)await wait(100);
  const data=await invoke('library_catalog',{q:'',category:'props',page:1});
  const item=data.assets.find(a=>!ids.has(a.id));if(!item)throw Error('No new object for cross-window test.');
  const button=document.querySelector(`[data-asset="${item.id}"] button`);if(!button)throw Error('Download button not rendered.');
  button.click();
  for(let i=0;i<200&&!window.studioCatalog.saved.has(item.id);i++)await wait(100);
  if(!window.studioCatalog.saved.has(item.id))throw Error('Catalog download failed.');
  report={ok:true,windowWidth:innerWidth,windowHeight:innerHeight,categories:[...category.options].map(o=>o.text),downloaded:item.name,footerVisible:document.querySelector('.catalog-footer').getBoundingClientRect().bottom<=innerHeight+1,columns:getComputedStyle(document.getElementById('catalog-grid')).gridTemplateColumns.split(' ').length};
 }catch(e){report={ok:false,error:String(e)};}
 await window.__TAURI__.core.invoke('native_smoke_report',{report,kind:'catalog'});
})();
