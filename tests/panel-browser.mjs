// Optional Chromium integration check. Dependencies are outside the application lockfile.
// JARVIS_PLAYWRIGHT_MODULE=/path/to/playwright-core node tests/panel-browser.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createServer } from '../apps/local-server/server.mjs';
import { createFileTools } from '../packages/files/index.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.JARVIS_PLAYWRIGHT_MODULE || 'playwright-core');
const root=await mkdtemp(path.join(tmpdir(),'jarvis-panel-browser-'));
const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
const errors=[];
const app=createServer({port,accessCode:'local-browser-fixture',logger:{info(){},warn(){}},
 memoryFilePath:path.join(root,'memory.json'),residentVoiceSettingsPath:path.join(root,'voice.json'),residentVoiceDiagnosticsPath:path.join(root,'diagnostics.json'),
 googleApiKey:'',googleModel:'',openaiEnabled:false,openrouterApiKey:'',
 executeAction:(action,params)=>createFileTools({root}).run(action,params)});
await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1366,height:900}});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('dialog',dialog=>dialog.accept());
 await page.goto(`http://127.0.0.1:${port}`);
 await page.locator('#code').fill('local-browser-fixture');
 await page.locator('#login-form button[type=submit]').click();
 await page.locator('#tools-panel').waitFor({state:'visible'});
 assert.equal(await page.locator('#backend-state').textContent(),'CONECTADO');
 await page.getByText('Memória permanente',{exact:true}).click();
 await page.locator('#memory-key').fill('user:projeto');await page.locator('#memory-value').fill('Jarvis Tech View');
 await page.locator('#memory-form button[type=submit]').click();
 await page.locator('#memory-items').getByText('user:projeto: Jarvis Tech View',{exact:true}).waitFor();
 await page.locator('#memory-items').getByRole('button',{name:'Editar',exact:true}).click();
 await page.locator('#memory-value').fill('Jarvis atualizado');await page.locator('#memory-form button[type=submit]').click();
 await page.locator('#memory-items').getByText('user:projeto: Jarvis atualizado',{exact:true}).waitFor();
 await page.getByText('Ferramentas autorizadas',{exact:true}).click();
 await page.locator('#tool-action').selectOption('files_create');await page.locator('#tool-path').fill('painel.txt');await page.locator('#tool-text').fill('Arquivo criado pelo painel.');
 await page.locator('#tool-form button[type=submit]').click();
 await page.locator('#requests').getByRole('button',{name:'Aprovar ação',exact:true}).waitFor();
 await page.locator('#requests').getByRole('button',{name:'Aprovar ação',exact:true}).click();
 await page.locator('#requests').getByText(/Ação processada/).waitFor();
 await page.locator('#tool-action').selectOption('files_read');await page.locator('#tool-path').fill('painel.txt');await page.locator('#tool-form button[type=submit]').click();
 await page.locator('#requests').getByRole('button',{name:'Aprovar ação',exact:true}).click();
 await page.locator('#tool-result').getByText('Arquivo criado pelo painel.',{exact:true}).waitFor();
 await page.getByText('Diagnósticos e provedores',{exact:true}).click();await page.locator('#diagnostics-refresh').click();
 await page.locator('#diagnostics-output').getByText(/Servidor: running/).waitFor();
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Layout não deve transbordar no celular');
 await page.locator('#memory-items').getByRole('button',{name:'Esquecer',exact:true}).click();
 await page.locator('#memory-items').getByText('Nenhuma informação salva.',{exact:true}).waitFor();
 await page.locator('#logout').click();await page.locator('#login').waitFor({state:'visible'});
 assert.equal(await page.locator('#tools-panel').isVisible(),false);
 assert.deepEqual(errors,[]);
 console.log('PASS Chromium: login, memória CRUD, aprovação, arquivo real temporário, diagnósticos, layout móvel e logout. Sem erros JavaScript.');
}finally{await browser?.close();await app.close();await rm(root,{recursive:true,force:true});}
