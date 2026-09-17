// Isolated, synthetic UI preview. Never overwrite, decrypt, or serve committed data.json.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,resolve,extname,sep} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scratch=resolve(root,'tmp/experience-preview');await mkdir(scratch,{recursive:true});
const sample=resolve(scratch,'sample.json');
let generator=await readFile(resolve(root,'producer/make-sample-data.mjs'),'utf8');
generator=generator.replace(/from '(\.\/[^']+)'/g,(_,p)=>'from '+JSON.stringify(pathToFileURL(resolve(root,'producer',p)).href));
generator=generator.replace('await emit(data);','writeFileSync('+JSON.stringify(sample)+',JSON.stringify(data));');
const generated=resolve(scratch,'generate.mjs');await writeFile(generated,generator);
await import(pathToFileURL(generated).href);
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    let file=url.pathname==='/data.json'?sample:resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    if(url.pathname==='/sw.js'){res.writeHead(404).end();return;} // no PWA caching of test data
    let body=await readFile(file);
    if(file.endsWith('index.html'))body=Buffer.from(body.toString().replace('<body>','<body><div style="padding:8px;color:#e3c074;background:#000">LOCAL PREVIEW — SYNTHETIC SAMPLE DATA</div>'));
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
  }catch(_){res.writeHead(404).end('Not found');}
}).listen(8767,'127.0.0.1',()=>console.log('Synthetic preview: http://127.0.0.1:8767'));
