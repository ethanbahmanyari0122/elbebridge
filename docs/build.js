const path=require('path'),fs=require('fs');
const SC=path.resolve(__dirname,'../scanner/node_modules');
const {chromium}=require(path.join(SC,'playwright'));
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const p=await (await b.newContext()).newPage();
  await p.goto('file://'+path.join(__dirname,'workflow.html'),{waitUntil:'networkidle'});
  await p.emulateMedia({media:'print'});
  const out=path.join(__dirname,'elbebridge-how-we-work.pdf');
  const buf=await p.pdf({format:'A4',printBackground:true,displayHeaderFooter:true,
    headerTemplate:'<div></div>',
    footerTemplate:`<div style="width:100%;font-size:7.5pt;color:#4c5768;padding:0 16mm;
      font-family:sans-serif;display:flex;justify-content:space-between;">
      <span>elbebridge &middot; how we work &middot; v1.0</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    margin:{top:'18mm',right:'16mm',bottom:'20mm',left:'16mm'}});
  fs.writeFileSync(out,buf);
  const pages=(buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)||[]).length;
  console.log(`${out}\n  ${pages} pages · ${(buf.length/1024).toFixed(0)} KB`);
  await b.close();
})();
