import { createCatalog } from './catalog.js';
const catalog=createCatalog({
  standalone:true,register:()=>{},changed:()=>{},clearKeys:()=>{},
  notice:message=>document.getElementById('catalog-status').textContent=message,
});
window.studioCatalog=catalog;
void catalog.collect().then(()=>catalog.refresh()).then(()=>catalog.acceptLinks()).catch(error=>document.getElementById('catalog-status').textContent=String(error));
