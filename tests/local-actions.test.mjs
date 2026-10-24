import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { detectLocalAction } from '../packages/core/intent.mjs';
import { runDesktopAction } from '../packages/desktop/index.mjs';
import { LOCAL_APPS, LOCAL_FOLDERS, LOCAL_SITES, localActionConfirmation, validateLocalAction } from '../packages/contracts/local-actions.mjs';

test('catálogo local valida allowlists e rejeita parâmetros arbitrários',()=>{
  assert.deepEqual(validateLocalAction('open_app',{app:'spotify'}),{action:'open_app',params:{app:'spotify'}});
  assert.deepEqual(validateLocalAction('open_folder',{folder:'downloads'}),{action:'open_folder',params:{folder:'downloads'}});
  assert.deepEqual(validateLocalAction('open_site',{site:'youtube'}),{action:'open_site',params:{site:'youtube'}});
  assert.deepEqual(validateLocalAction('set_volume',{percent:0}),{action:'set_volume',params:{percent:0}});
  assert.deepEqual(validateLocalAction('set_volume',{percent:100}),{action:'set_volume',params:{percent:100}});
  assert.deepEqual(validateLocalAction('search_google',{query:'  RTX 4060  '}),{action:'search_google',params:{query:'RTX 4060'}});
  assert.deepEqual(validateLocalAction('search_youtube',{query:'música gaúcha'}),{action:'search_youtube',params:{query:'música gaúcha'}});
  assert.deepEqual(validateLocalAction('play_youtube',{query:'Fundo da Grota'}),{action:'play_youtube',params:{query:'Fundo da Grota'}});
  assert.deepEqual(validateLocalAction('volume_down',{}),{action:'volume_down',params:{}});
  for (const app of Object.keys(LOCAL_APPS)) assert.ok(validateLocalAction('open_app',{app}));
  for (const folder of Object.keys(LOCAL_FOLDERS)) assert.ok(validateLocalAction('open_folder',{folder}));
  for (const site of Object.keys(LOCAL_SITES)) assert.ok(validateLocalAction('open_site',{site}));
  for (const proposal of [
    ['open_app',{app:'powershell'}], ['open_app',{app:'spotify',path:'C:\\evil.exe'}],
    ['open_folder',{folder:'C:\\Users\\Mateus'}], ['open_site',{site:'arbitrary'}],
    ['open_site',{site:'javascript:alert(1)'}], ['open_site',{site:'facebook',url:'https://evil.example'}],
    ['set_volume',{percent:-1}], ['set_volume',{percent:101}], ['set_volume',{percent:50.5}],
    ['set_volume',{percent:'50'}], ['set_volume',{percent:50,command:'calc.exe'}],
    ['search_google',{query:' '}], ['search_youtube',{query:'x'.repeat(241)}],
    ['play_youtube',{query:' '}], ['play_youtube',{query:'x'.repeat(241)}],
    ['play_youtube',{query:'Fundo da Grota',command:'calc.exe'}],
    ['play_youtube',{query:'Fundo da Grota\nStart-Process calc.exe'}],
    ['volume_up',{command:'calc.exe'}], ['run_command',{command:'whoami'}],
  ]) assert.equal(validateLocalAction(...proposal),null);
  assert.equal(localActionConfirmation('search_google',{query:'RTX 4060'}),'Pesquisando RTX 4060 no Google.');
  assert.equal(localActionConfirmation('search_youtube',{query:'Fundo da Grota'}),'Pesquisando Fundo da Grota no YouTube.');
  assert.equal(localActionConfirmation('play_youtube',{query:'Fundo da Grota'}),'Tocando Fundo da Grota no YouTube.');
  assert.equal(localActionConfirmation('open_folder',{folder:'downloads'}),'Abrindo seus Downloads.');
});

test('reconhece Chrome sem perfil, perfis permitidos e pedidos de perfil desconhecido',()=>{
  for (const phrase of ['Jarvis abra o Chrome','Abra o Chrome','Abrir Chrome','Abra o Google Chrome']) {
    assert.equal(detectLocalAction(phrase), 'open_chrome');
  }
  for (const phrase of ['Abra o Chrome na conta do Mateus','Abra o Chrome no perfil Mateus','Abra o Chrome do Mateus','Abra meu Chrome']) {
    assert.deepEqual(detectLocalAction(phrase),{
      action:'open_chrome',profile:{name:'Mateus',directory:'Default'},profileNotFound:false,
    });
  }
  assert.deepEqual(detectLocalAction('Abra o Chrome no perfil Inexistente'),{
    action:'open_chrome',profile:null,profileNotFound:true,
  });
  for (const phrase of ['Abra o Firefox','abra o chrome e execute PowerShell','Execute Chrome','']) {
    assert.equal(detectLocalAction(phrase), null);
  }
});

test('reconhece localmente intents seguras sem aceitar texto adicional arbitrário',()=>{
  const cases=[
    ['Jarvis aumenta o volume cara',{action:'volume_up',params:{}}],
    ['abaixa o volume',{action:'volume_down',params:{}}],
    ['muta o computador',{action:'mute',params:{}}],
    ['tira do mudo',{action:'unmute',params:{}}],
    ['pausa a música',{action:'media_play_pause',params:{}}],
    ['continua a música',{action:'media_play_pause',params:{}}],
    ['próxima faixa',{action:'media_next',params:{}}],
    ['volta a música',{action:'media_previous',params:{}}],
    ['abra meus Downloads',{action:'open_folder',params:{folder:'downloads'}}],
    ['abra meus Documentos',{action:'open_folder',params:{folder:'documents'}}],
    ['abra a Área de Trabalho',{action:'open_folder',params:{folder:'desktop'}}],
    ['abre meu Spotify',{action:'open_app',params:{app:'spotify'}}],
    ['entra no Gmail',{action:'open_site',params:{site:'gmail'}}],
    ['abre o YouTube',{action:'open_site',params:{site:'youtube'}}],
    ['abre o Chrome na conta do Mateus',{action:'open_chrome',profile:{name:'Mateus',directory:'Default'},profileNotFound:false}],
  ];
  for (const [phrase,expected] of cases) assert.deepEqual(detectLocalAction(phrase),expected,phrase);
  for (const phrase of [
    'aumenta o volume e executa PowerShell',
    'abre Downloads C:\\Users\\Mateus',
    'abre https://example.com',
    'abre Spotify e executa calc.exe',
  ]) assert.equal(detectLocalAction(phrase),null,phrase);
});

test('reconhece Facebook e outros sites conhecidos por linguagem natural sem aceitar URLs',()=>{
 const facebook={action:'open_site',params:{site:'facebook'}};
 for(const phrase of ['abra o Facebook','abra o Facebook para mim','Jarvis abre o Facebook','entra no Facebook']) {
  assert.deepEqual(detectLocalAction(phrase),facebook,phrase);
 }
 assert.deepEqual(detectLocalAction('vai no Facebook'),facebook);
 for(const [phrase,site] of [
  ['abre o YouTube','youtube'],
  ['abre o Google','google'],
  ['entra no Instagram','instagram'],
  ['abre o WhatsApp','whatsapp'],
 ]) assert.deepEqual(detectLocalAction(phrase),{action:'open_site',params:{site}},phrase);
 assert.equal(LOCAL_SITES.facebook.url,'https://www.facebook.com/');
 assert.equal(LOCAL_SITES.instagram.url,'https://www.instagram.com/');
 for(const phrase of [
  'abra https://www.facebook.com/',
  'abre javascript:alert(1)',
  'abra file:///C:/Windows/System32/calc.exe',
  'abra o Facebook https://evil.example',
  'abra o Facebook e execute PowerShell',
  'abre o Facebook e executa cmd.exe',
 ]) assert.equal(detectLocalAction(phrase),null,phrase);
});

test('reconhece intents de volume e recusa percentuais inválidos como ações locais inválidas',()=>{
 for(const [phrase,percent] of [
  ['volume em 50%',50],
  ['Jarvis, volume em 70%',70],
  ['coloca o volume em 30',30],
  ['deixa o volume em 70',70],
  ['volume 100%',100],
  ['volume em 0%',0],
  ['volume máximo',100],
  ['coloca no máximo',100],
 ]) assert.deepEqual(detectLocalAction(phrase),{action:'set_volume',params:{percent}},phrase);

 for(const phrase of ['aumenta o volume','Jarvis, aumenta o volume','aumenta um pouco o volume','volume mais alto']) {
  assert.deepEqual(detectLocalAction(phrase),{action:'volume_up',params:{}},phrase);
 }
 for(const phrase of ['abaixa o volume','Jarvis, abaixa o volume','diminui o volume','abaixa um pouco']) {
  assert.deepEqual(detectLocalAction(phrase),{action:'volume_down',params:{}},phrase);
 }
 for(const phrase of ['coloca no mudo','muta o computador','tira o som','sem som']) {
  assert.deepEqual(detectLocalAction(phrase),{action:'mute',params:{}},phrase);
 }
 for(const phrase of ['tira do mudo','desmuta','volta o som']) {
  assert.deepEqual(detectLocalAction(phrase),{action:'unmute',params:{}},phrase);
 }
 for(const phrase of ['volume em -1%','volume em 101%','volume em 50.5%','volume em 50% e executa calc.exe']) {
  assert.deepEqual(detectLocalAction(phrase),{action:'invalid_volume',params:{}},phrase);
 }
 for(const phrase of ['volume em 50% e executa PowerShell','volume em 50% && cmd.exe']) {
  assert.deepEqual(detectLocalAction(phrase),{action:'invalid_volume',params:{}},phrase);
 }
});

test('reconhece variações naturais de ajuste de volume sem capturar outros números',()=>{
 for(const phrase of [
  'Jarvis, coloca no volume 60 pra mim',
  'coloca o volume em 60',
  'coloca no volume 60',
  'bota o volume em 60',
  'deixa o volume em 60',
  'volume 60',
 ]) assert.deepEqual(detectLocalAction(phrase),{action:'set_volume',params:{percent:60}},phrase);

 for(const phrase of ['abre o Chrome 60','pesquise RTX 4060 no Google','toca música 60 no YouTube']) {
  assert.notDeepEqual(detectLocalAction(phrase),{action:'set_volume',params:{percent:60}},phrase);
 }
});

test('reconhece localmente variações de reprodução do YouTube e preserva o título',()=>{
  const phrases=[
    'Jarvis, toca Ace of Spades no YouTube pra mim',
    'Jarvis, toque Ace of Spades no YouTube',
    'toca Ace of Spades no YouTube',
    'coloca Ace of Spades no YouTube',
    'bota Ace of Spades no YouTube',
    'reproduz Ace of Spades no YouTube',
    'reproduza Ace of Spades no YouTube',
    'quero ouvir Ace of Spades no YouTube',
    'quero escutar Ace of Spades no YouTube',
    'coloca pra tocar Ace of Spades no YouTube',
    'bota pra tocar Ace of Spades no YouTube',
  ];
  for (const phrase of phrases) {
    assert.deepEqual(detectLocalAction(phrase),{action:'play_youtube',params:{query:'Ace of Spades'}},phrase);
  }
  assert.deepEqual(detectLocalAction('toca Música Pra Mim no YouTube'),{
    action:'play_youtube',params:{query:'Música Pra Mim'},
  });
});

test('diferencia pesquisas YouTube de reprodução e reconhece Google localmente',()=>{
  assert.deepEqual(detectLocalAction('Jarvis, pesquise Ace of Spades no YouTube'),{
    action:'search_youtube',params:{query:'Ace of Spades'},
  });
  assert.deepEqual(detectLocalAction('pesquise música gaúcha no YouTube'),{
    action:'search_youtube',params:{query:'música gaúcha'},
  });
  assert.deepEqual(detectLocalAction('pesquise preço da RTX 4060 no Google'),{
    action:'search_google',params:{query:'preço da RTX 4060'},
  });
  assert.equal(detectLocalAction('toca no YouTube'),null);
});

test('open_chrome inicia apenas o executável fixo, sem shell ou argumentos',async()=>{
  const calls=[];
  let unreferenced=false;
  const expected='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const result=await runDesktopAction('open_chrome',{
    platform:'win32',
    env:{ProgramFiles:'C:\\Program Files'},
    exists:executable=>executable===expected,
    spawnProcess:(...args)=>{
      calls.push(args);
      const child=new EventEmitter();
      child.unref=()=>{unreferenced=true;};
      queueMicrotask(()=>child.emit('spawn'));
      return child;
    },
  });
  assert.deepEqual(result,{ok:true,status:'launched',verified:false,message:'Abrindo o Chrome, Mateus.'});
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],expected);
  assert.deepEqual(calls[0][1],[]);
  assert.equal(calls[0][2].shell,false);
  assert.equal(calls[0][2].windowsHide,true);
  assert.equal(unreferenced,true);
});

test('ação desconhecida, sistema não Windows e Chrome ausente não iniciam processos',async()=>{
  let spawned=false;
  const spawnProcess=()=>{spawned=true;throw new Error('não deveria iniciar');};
  await assert.rejects(runDesktopAction('run_command',{platform:'win32',spawnProcess}),/ACTION_NOT_ALLOWED/);
  await assert.rejects(runDesktopAction('open_chrome',{platform:'linux',spawnProcess}),/WINDOWS_ONLY/);
  await assert.rejects(runDesktopAction('open_chrome',{platform:'win32',exists:()=>false,spawnProcess}),/CHROME_NOT_FOUND/);
  assert.equal(spawned,false);
});

test('open_chrome seleciona somente o diretório de perfil allowlisted',async()=>{
  const calls=[];
  const child=new EventEmitter();
  child.unref=()=>{};
  const expected='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  await runDesktopAction('open_chrome',{
    platform:'win32',profileName:'Mateus',env:{ProgramFiles:'C:\\Program Files'},
    exists:executable=>executable===expected,
    spawnProcess:(...args)=>{calls.push(args);queueMicrotask(()=>child.emit('spawn'));return child;},
  });
  assert.deepEqual(calls[0][1],['--profile-directory=Default']);
  await assert.rejects(runDesktopAction('open_chrome',{platform:'win32',profileName:'Mateus --remote-debugging-port=9222',spawnProcess:()=>{throw new Error('não deveria iniciar');}}),/PROFILE_NOT_ALLOWED/);
});

test('open_app inicia executável do catálogo sem shell e detecta o caminho pelo Windows',async()=>{
  const calls=[];
  const executable='C:\\Windows\\System32\\notepad.exe';
  const child=new EventEmitter();
  child.unref=()=>{};
  await runDesktopAction('open_app',{app:'notepad',platform:'win32',env:{WINDIR:'C:\\Windows'},exists:value=>value===executable,
    spawnProcess:(...args)=>{calls.push(args);queueMicrotask(()=>child.emit('spawn'));return child;}});
  assert.equal(calls[0][0],executable);
  assert.deepEqual(calls[0][1],[]);
  assert.equal(calls[0][2].shell,false);
  assert.equal(calls[0][2].windowsHide,false);
  await assert.rejects(runDesktopAction('open_app',{app:'C:\\evil.exe',platform:'win32',spawnProcess:()=>{throw new Error('não deveria iniciar');}}),/ACTION_NOT_ALLOWED/);
});

test('pastas e pesquisas usam caminhos fixos e codificam a consulta',async()=>{
  const calls=[];
  const child=new EventEmitter();
  child.unref=()=>{};
  const common={platform:'win32',env:{WINDIR:'C:\\Windows',USERPROFILE:'C:\\Users\\Mateus'},exists:()=>true,
    spawnProcess:(...args)=>{calls.push(args);queueMicrotask(()=>{child.emit('spawn');child.emit('close',0);});return child;}};
  await runDesktopAction('open_folder',{...common,folder:'downloads'});
  await runDesktopAction('search_google',{...common,query:'RTX 4060 & preço'});
  await runDesktopAction('search_youtube',{...common,query:'música gaúcha'});
  assert.deepEqual(calls[0][1],['C:\\Users\\Mateus\\Downloads']);
  const protocolHandler='C:\\Windows\\System32\\rundll32.exe';
  assert.equal(calls[1][0],protocolHandler);
  assert.deepEqual(calls[1][1],['url.dll,FileProtocolHandler','https://www.google.com/search?q=RTX+4060+%26+pre%C3%A7o']);
  assert.equal(calls[2][0],protocolHandler);
  assert.deepEqual(calls[2][1],['url.dll,FileProtocolHandler','https://www.youtube.com/results?search_query=m%C3%BAsica+ga%C3%BAcha']);
  assert.ok(calls.slice(1).every(([, , options])=>options.shell===false));
  await assert.rejects(runDesktopAction('open_folder',{...common,folder:'C:\\Users\\Mateus'}),/ACTION_NOT_ALLOWED/);
});

test('sites permitidos abrem somente URLs definidas internamente',async()=>{
  const calls=[];
  const child=new EventEmitter();
  child.unref=()=>{};
  for (const site of Object.keys(LOCAL_SITES)) {
    await runDesktopAction('open_site',{site,platform:'win32',env:{WINDIR:'C:\\Windows'},exists:()=>true,
      spawnProcess:(...args)=>{calls.push(args);queueMicrotask(()=>{child.emit('spawn');child.emit('close',0);});return child;}});
  }
  assert.deepEqual(calls.map(args=>args[1]),Object.values(LOCAL_SITES).map(entry=>['url.dll,FileProtocolHandler',entry.url]));
  assert.ok(calls.every(args=>args[0]==='C:\\Windows\\System32\\rundll32.exe' && args[2].shell===false && args[2].windowsHide===false));
});

test('controles de mídia usam somente tecla Windows predefinida sem shell',async()=>{
  const calls=[];
  const child=new EventEmitter();
  child.unref=()=>{};
  const keys={media_play_pause:179,media_next:176,media_previous:177};
  for (const [action,key] of Object.entries(keys)) {
    await runDesktopAction(action,{platform:'win32',env:{WINDIR:'C:\\Windows'},exists:()=>true,
      spawnProcess:(...args)=>{calls.push(args);queueMicrotask(()=>{child.emit('spawn');child.emit('close',0);});return child;}});
    const args=calls.at(-1);
    assert.equal(args[0],'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(args[2].shell,false);
    assert.equal(args[2].windowsHide,true);
    const encoded=args[1][args[1].indexOf('-EncodedCommand')+1];
    const script=Buffer.from(encoded,'base64').toString('utf16le');
    assert.ok(script.includes(`keybd_event(${key}, 0, 0`));
    assert.doesNotMatch(script,/Start-Process|cmd\.exe/);
  }
  assert.equal(calls.length,Object.keys(keys).length);
});

test('ações de volume usam controlador mockado, percentuais reais e clamp de 0–100',async()=>{
 let percent=40,muted=false;
 const calls=[];
 const volumeController={
  setVolume:async value=>{calls.push(['set',value]);percent=value;},
  adjustVolume:async amount=>{calls.push(['adjust',amount]);percent=Math.max(0,Math.min(100,percent+amount));},
  setMuted:async value=>{calls.push(['mute',value]);muted=value;},
 };
 await runDesktopAction('set_volume',{percent:50,platform:'win32',volumeController});
 await runDesktopAction('volume_up',{platform:'win32',volumeController});
 assert.equal(percent,60);
 await runDesktopAction('volume_down',{platform:'win32',volumeController});
 assert.equal(percent,50);
 percent=95;
 await runDesktopAction('volume_up',{platform:'win32',volumeController});
 assert.equal(percent,100);
 percent=5;
 await runDesktopAction('volume_down',{platform:'win32',volumeController});
 assert.equal(percent,0);
 await runDesktopAction('mute',{platform:'win32',volumeController});
 assert.equal(muted,true);
 await runDesktopAction('unmute',{platform:'win32',volumeController});
 assert.equal(muted,false);
 assert.deepEqual(calls,[['set',50],['adjust',10],['adjust',-10],['adjust',10],['adjust',-10],['mute',true],['mute',false]]);
});

test('backend Windows de volume usa executável fixo e script codificado sem entrada arbitrária',async()=>{
 const calls=[];
 const executable='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
 const spawnProcess=(...args)=>{
  calls.push(args);
  const child=new EventEmitter();
  child.unref=()=>{};
  queueMicrotask(()=>child.emit('close',0));
  return child;
 };
 await runDesktopAction('set_volume',{percent:42,platform:'win32',env:{WINDIR:'C:\\Windows'},
  exists:value=>value===executable,spawnProcess});
 assert.equal(calls[0][0],executable);
 assert.equal(calls[0][2].shell,false);
 assert.equal(calls[0][2].detached,false);
 const encodedIndex=calls[0][1].indexOf('-EncodedCommand');
 assert.notEqual(encodedIndex,-1);
 const script=Buffer.from(calls[0][1][encodedIndex+1],'base64').toString('utf16le');
 assert.match(script,/GetDefaultAudioEndpoint/);
 assert.match(script,/SetPercent\(42\)/);
 assert.match(script,/\[PreserveSig\] int GetDefaultAudioEndpoint/);
 assert.match(script,/VOLUME_NOT_CONFIRMED/);
 assert.doesNotMatch(script,/Start-Process|cmd\.exe|evil/);

 let spawned=false;
 await assert.rejects(runDesktopAction('set_volume',{percent:42,command:'calc.exe',platform:'win32',spawnProcess:()=>{spawned=true;}}),/ACTION_NOT_ALLOWED/);
 assert.equal(spawned,false);

 const failedProcess=()=>{
  const child=new EventEmitter();
  queueMicrotask(()=>child.emit('close',1));
  return child;
 };
 await assert.rejects(runDesktopAction('set_volume',{percent:42,platform:'win32',env:{WINDIR:'C:\\Windows'},
  exists:()=>true,spawnProcess:failedProcess}),/VOLUME_CONTROL_FAILED/);
});

test('play_youtube abre um vídeo encontrado usando apenas um ID validado do YouTube',async()=>{
  const calls=[];
  const child=new EventEmitter();
  child.unref=()=>{};
  const query='Fundo da Grota & execute calc.exe';
  let requestedUrl;
  const result=await runDesktopAction('play_youtube',{query,platform:'win32',env:{WINDIR:'C:\\Windows'},exists:()=>true,
    fetchPage:async(url,options)=>{
      requestedUrl=url;
      assert.equal(options.redirect,'error');
      assert.equal(new URL(url).origin,'https://www.youtube.com');
      return new Response('<script>var ytInitialData = {"videoRenderer":{"videoId":"abcdefghijk"}};</script>',
        {headers:{'Content-Type':'text/html'}});
    },
    spawnProcess:(...args)=>{calls.push(args);queueMicrotask(()=>{child.emit('spawn');child.emit('close',0);});return child;}});
  assert.equal(requestedUrl,'https://www.youtube.com/results?search_query=Fundo+da+Grota+%26+execute+calc.exe');
  assert.equal(calls[0][0],'C:\\Windows\\System32\\rundll32.exe');
  assert.deepEqual(calls[0][1],['url.dll,FileProtocolHandler','https://www.youtube.com/watch?v=abcdefghijk&autoplay=1']);
  assert.equal(calls[0][2].shell,false);
  assert.equal(result.message,`Abrindo um vídeo de ${query} no YouTube. A reprodução ainda não foi verificada.`);
  assert.equal(result.verified,false);
});

test('play_youtube abre resultados e não afirma reprodução quando não localiza vídeo',async()=>{
  const calls=[];
  const child=new EventEmitter();
  child.unref=()=>{};
  const result=await runDesktopAction('play_youtube',{query:'Fundo da Grota',platform:'win32',env:{WINDIR:'C:\\Windows'},exists:()=>true,
    fetchPage:async()=>new Response('<html>sem resultados de vídeo</html>',{headers:{'Content-Type':'text/html'}}),
    spawnProcess:(...args)=>{calls.push(args);queueMicrotask(()=>{child.emit('spawn');child.emit('close',0);});return child;}});
  assert.deepEqual(calls[0][1],['url.dll,FileProtocolHandler','https://www.youtube.com/results?search_query=Fundo+da+Grota']);
  assert.match(result.message,/Não consegui iniciar a reprodução automaticamente/);
  assert.doesNotMatch(result.message,/Tocando/);
});

test('play_youtube rejeita query inválida antes de buscar ou iniciar processo',async()=>{
  let fetched=false,spawned=false;
  await assert.rejects(runDesktopAction('play_youtube',{query:'',platform:'win32',fetchPage:async()=>{fetched=true;},
    spawnProcess:()=>{spawned=true;throw new Error('não deveria iniciar');}}),/ACTION_NOT_ALLOWED/);
  assert.equal(fetched,false);
  assert.equal(spawned,false);
});
