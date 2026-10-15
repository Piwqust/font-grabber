// Real FontFace decoding and queue lifecycle, without a third-party network.
const { build } = require('esbuild');
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
  const bundle = await build({stdin:{contents:
    'import {render,h} from "preact"; import {Preview} from "./core/src/web/src/catalog/Preview.jsx"; import {resetPreviews} from "./core/src/web/src/lib/previews.js"; window.show = items => render(h("div", {}, items.map(item=>h(Preview,{key:item.key,font:item.font,text:"Preview test"}))),document.getElementById("root")); window.reset = resetPreviews;',
    resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',jsxImportSource:'preact'});
  const font = fs.readFileSync('core/src/web/assets/geist-400.woff2');
  let active=0,peak=0;
  const requests=[];
  const server=http.createServer((req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);return;}
    if(req.url.startsWith('/api/font')){
      const source=new URL(req.url,'http://test').searchParams.get('url');
      requests.push(source); active++;peak=Math.max(peak,active);
      res.once('close',()=>active--);
      setTimeout(()=>{res.statusCode=source==='broken'?502:200;res.end(source==='broken'?'temporary failure':font);},200);return;
    }
    res.setHeader('Content-Type','text/html');
    res.end('<div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
    const show=async (keys,broken=false)=>page.evaluate(({keys,broken})=>window.show(keys.map(key=>({key,font:{id:key.split(':')[0],sources:[...(broken&&key==='a'?[{url:'broken'}]:[]),{url:key.split(':')[0]}]}}))),{keys,broken});
    await show(['a','b','c:old'],true);
    await page.waitForFunction(()=>document.querySelectorAll('.is-loading').length===3);
    // The queued font survives replacement of the first DOM node needing it.
    await show(['a','b','c:new'],true);
    await page.waitForFunction(()=>document.querySelectorAll('.is-ready').length===3);
    assert(peak<=2, 'At most two font requests can be active');
    assert.equal(requests.filter(s=>s==='broken').length,2,'One retry before fallback');
    assert(requests.includes('a')&&requests.includes('c'),'Fallback and replacement both load');
    await show([]);await page.evaluate(()=>window.reset());
    const before=requests.length;await show(['cancel1','cancel2','cancel3']);
    await page.waitForFunction(()=>document.querySelectorAll('.is-loading').length===3);
    await page.waitForTimeout(75);await page.evaluate(()=>{window.reset();window.show([])});
    await page.waitForTimeout(800);
    assert(!requests.slice(before).includes('cancel3'),'Reset clears pending requests');
    assert.equal(requests.slice(before).length,new Set(requests.slice(before)).size,'Aborted requests are never retried');
    await show(['fresh']);await page.locator('.is-ready').waitFor();
    console.log('PASS: concurrency, fallback, shared face remount, reset cancellation, new scan, real FontFace decode');
  } finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(String(error).split('Call log:')[0]);process.exitCode=1;});
