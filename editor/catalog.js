// Catalog discovery is remote; the personal collection and model bytes are native.
export const libraryNative = window.parent.__TAURI__?.core;
export function bufferBase64(buffer) {
  const bytes = new Uint8Array(buffer); let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(binary);
}
export function modelFile(data, name) {
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  return new File([bytes], `${name}.glb`, { type: 'model/gltf-binary' });
}
export function createCatalog({ register, changed, notice, clearKeys, standalone=false }) {
  const $ = id => document.getElementById(id), dialog = $('catalog-dialog');
  const saved = new Map(); let page = 1, pages = 1, request = 0, timer, openedBy;
  const downloads = new Map(), buttonUpdates = new Map();
  const status = message => { $('catalog-status').textContent = message; };
  const link = (label, url) => {
    const a = document.createElement('a'); a.textContent = label;
    try { const parsed = new URL(url); if (!['https:','http:'].includes(parsed.protocol)) return a; a.href=parsed.href; a.target='_blank'; a.rel='noopener noreferrer'; if(libraryNative)a.onclick=event=>{event.preventDefault();void libraryNative.invoke('library_open_link',{url:parsed.href}).catch(error=>notice(String(error)));}; } catch { /* Show plain credit if no link. */ }
    return a;
  };
  async function collect() {
    if (!libraryNative) return;
    const result = await libraryNative.invoke('library_list');
    for (const item of result.assets) { saved.set(item.id,item); register(item,false); }
    changed();for(const update of buttonUpdates.values())update();
    $('collection-path').textContent = 'Saved in Documents/TanaStudio';
    $('collection-path').title = result.root;
    if (result.skipped) notice(`${result.skipped} saved library record${result.skipped===1?'':'s'} could not be read. Your other assets are available.`);
  }
  async function download(id) {
    if (!libraryNative) throw new Error('Open Studio on your desktop to save assets to your collection.');
    if (downloads.has(id)) return downloads.get(id);
    const pending = libraryNative.invoke('library_download',{id}).then(item => {
      saved.set(item.id,item); register(item); return item;
    }).finally(() => downloads.delete(id));
    downloads.set(id,pending);return pending;
  }
  async function load() {
    const revision = ++request; status('Loading the library…'); $('catalog-grid').setAttribute('aria-busy','true');
    $('catalog-prev').disabled=true; $('catalog-next').disabled=true;
    const q=$('catalog-search').value.trim(),category=$('catalog-category').value;
    try {
      const data = libraryNative ? await libraryNative.invoke('library_catalog',{q,category,page}) : await (async () => {
        const params=new URLSearchParams({q,category,page:String(page),limit:'24'});
        const response=await fetch(`https://tana.gg/api/assets?${params}`);
        if(!response.ok)throw new Error('The library is unavailable. Please try again.');return response.json();
      })();
      if(revision!==request)return;
      if(!Array.isArray(data.assets))throw new Error('Could not read the library. Please try again.');
      pages=data.pages;page=data.page;
      $('catalog-grid').replaceChildren();buttonUpdates.clear();
      for(const asset of data.assets){
        const card=document.createElement('article');card.className='catalog-card';card.dataset.asset=asset.id;
        const image=document.createElement('img');image.alt='';image.loading='lazy';image.decoding='async';
        const key=asset.poster_key||asset.preview_key;
        if(typeof key==='string'&&key.startsWith('assets/')&&!key.split('/').some(p=>p==='..')) image.src=`https://tana.gg/media/${key.split('/').map(encodeURIComponent).join('/')}`;
        image.style.backgroundColor=/^#[\da-f]{6}$/i.test(asset.colour)?asset.colour:'#263034';
        const title=document.createElement('h3');title.textContent=asset.name;
        const description=document.createElement('p');description.className='catalog-description';description.textContent=asset.description;
        const tags=document.createElement('p');tags.className='catalog-tags';tags.textContent=(asset.tags??[]).slice(0,5).join(' · ');
        const count=document.createElement('p');count.className='catalog-downloads';
        const credits=document.createElement('p');credits.className='catalog-credit';credits.append(link(asset.creator,asset.source_url),document.createTextNode(' · '),link(asset.license,asset.license_url));
        if(asset.animations?.length){const badge=document.createElement('span');badge.className='catalog-animation';badge.textContent=`${asset.animations.length} animations`;card.append(badge);}
        const button=document.createElement('button');button.className='primary';
        const update=()=>{count.textContent=`${Math.max(asset.downloads??0,saved.get(asset.id)?.catalog?.downloads??0).toLocaleString()} downloads`;button.textContent=saved.has(asset.id)?'In your collection':downloads.has(asset.id)?'Downloading…':'Add to collection';button.disabled=saved.has(asset.id)||downloads.has(asset.id)||!libraryNative;};buttonUpdates.set(asset.id,update);update();
        button.onclick=async()=>{const pending=download(asset.id);update();try{await pending;status(`${asset.name} added to your collection.`);notice(`${asset.name} is ready in your library.`);}catch(error){status(`Could not download ${asset.name}: ${error.message??error}`);}finally{update();buttonUpdates.get(asset.id)?.();}};
        card.append(image,title,description,tags,credits,count,button);$('catalog-grid').append(card);
      }
      status(data.total?`${data.total.toLocaleString()} assets · Page ${page} of ${pages}`:'No assets found. Try another search.');
      $('catalog-page').textContent=pages?`${page} / ${pages}`:'';
      $('catalog-prev').disabled=page<=1;$('catalog-next').disabled=page>=pages;
    } catch(error){if(revision===request){status(error.message??String(error));$('catalog-grid').replaceChildren();}}
    finally{if(revision===request)$('catalog-grid').setAttribute('aria-busy','false');}
  }
  const size=(width,height,left,top)=>{
    const vw=window.innerWidth,vh=window.innerHeight;
    left=Math.max(16,Math.min(left,vw-536));top=Math.max(16,Math.min(top,vh-436));
    dialog.style.margin='0';dialog.style.left=`${left}px`;dialog.style.top=`${top}px`;dialog.style.right='auto';dialog.style.bottom='auto';
    dialog.style.width=`${Math.max(Math.min(520,vw-32),Math.min(width,vw-left-16))}px`;
    dialog.style.height=`${Math.max(Math.min(420,vh-32),Math.min(height,vh-top-16))}px`;
  };
  const resize=$('catalog-resize');
  resize.onpointerdown=event=>{
    if(event.button!==0)return;event.preventDefault();
    const rect=dialog.getBoundingClientRect(),x=event.clientX,y=event.clientY;
    resize.setPointerCapture(event.pointerId);
    resize.onpointermove=move=>size(rect.width+move.clientX-x,rect.height+move.clientY-y,rect.left,rect.top);
    resize.onpointerup=resize.onpointercancel=()=>{resize.onpointermove=null;};
  };
  resize.onkeydown=event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();const rect=dialog.getBoundingClientRect();
    size(rect.width+(event.key==='ArrowLeft'?-32:event.key==='ArrowRight'?32:0),rect.height+(event.key==='ArrowUp'?-32:event.key==='ArrowDown'?32:0),rect.left,rect.top);
  };
  window.addEventListener('resize',()=>{if(!standalone&&dialog.open){const rect=dialog.getBoundingClientRect();size(rect.width,rect.height,rect.left,rect.top);}});
  async function open({separate=!!libraryNative}={}){
    clearKeys();
    if(separate&&libraryNative)return libraryNative.invoke('library_open_browser');
    openedBy=document.activeElement;dialog.showModal();
    if(dialog.style.left){const rect=dialog.getBoundingClientRect();size(rect.width,rect.height,rect.left,rect.top);}
    void load();
  }
  if($('browse-catalog'))$('browse-catalog').onclick=()=>void open().catch(error=>notice(String(error)));
  const close=()=>standalone?libraryNative?.invoke('library_close_browser'):dialog.close();
  $('close-catalog').onclick=close;
  if(standalone)document.addEventListener('keydown',event=>{if(event.key==='Escape')void close();});
  dialog.addEventListener('close',()=>{clearKeys();openedBy?.focus();});
  $('catalog-search').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{page=1;void load();},250);};
  $('catalog-category').onchange=()=>{clearTimeout(timer);page=1;void load();};
  $('catalog-prev').onclick=()=>{page--;void load();};$('catalog-next').onclick=()=>{page++;void load();};
  $('catalog-retry').onclick=()=>void load();
  $('collection-folder').hidden=!libraryNative;
  $('collection-folder').onclick=()=>libraryNative.invoke('library_open_folder').catch(error=>status(String(error)));
  if(!libraryNative)$('collection-path').textContent='Open the desktop app to save assets to your collection.';
  const events=window.parent.__TAURI__?.event;
  if(events){
    const stop=events.listen('library-changed',()=>void collect().catch(error=>notice(String(error))));
    window.addEventListener('pagehide',()=>void stop.then(unlisten=>unlisten()).catch(()=>{}),{once:true});
    void stop.catch(error=>notice(`Library updates unavailable: ${error}`));
  }
  return { saved, collect, download, refresh:load, open };
}
