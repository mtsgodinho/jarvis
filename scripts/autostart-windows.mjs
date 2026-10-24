import { processEnvironment } from '../packages/security/process-environment.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
export function autostartScript({enable,nodePath=process.execPath,root=fileURLToPath(new URL('../',import.meta.url))}){
 const data=Buffer.from(JSON.stringify({enable,nodePath,root,entry:path.join(root,'scripts','supervisor.mjs')}),'utf8').toString('base64');
 return `$ErrorActionPreference='Stop';
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))|ConvertFrom-Json;
$startup=[Environment]::GetFolderPath('Startup');
$file=Join-Path $startup 'Jarvis Tech View.lnk';
$shell=New-Object -ComObject WScript.Shell;
if($p.enable){
 if(Test-Path -LiteralPath $file){throw 'AUTOSTART_ALREADY_EXISTS'};
 $shortcut=$shell.CreateShortcut($file);$shortcut.TargetPath=$p.nodePath;
 $shortcut.Arguments='"'+$p.entry+'"';$shortcut.WorkingDirectory=$p.root;
 $shortcut.Description='Jarvis Tech View - opt-in local startup';$shortcut.Save();
 Write-Output 'Inicialização automática habilitada. O microfone depende do consentimento salvo no painel.';
}else{
 if(Test-Path -LiteralPath $file){
  $shortcut=$shell.CreateShortcut($file);
  if($shortcut.TargetPath -ne $p.nodePath -or $shortcut.Arguments -ne ('"'+$p.entry+'"') -or $shortcut.Description -ne 'Jarvis Tech View - opt-in local startup'){throw 'AUTOSTART_NOT_OWNED'};
  Remove-Item -LiteralPath $file;
 }
 Write-Output 'Inicialização automática desabilitada.';
}`;
}
export async function configureAutostart({enable,platform=process.platform,spawnProcess=spawn,env=process.env}={}){
 if(platform!=='win32')throw new Error('WINDOWS_ONLY');
 if(typeof enable!=='boolean')throw new Error('EXPLICIT_OPT_IN_REQUIRED');
 const executable=path.win32.join(env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const script=autostartScript({enable});
 await new Promise((resolve,reject)=>{
  const child=spawnProcess(executable,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{shell:false,stdio:'inherit',env:processEnvironment(env)});
  child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error('AUTOSTART_FAILED')));
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const arg=process.argv[2];
 if(!['--enable','--disable'].includes(arg)||process.argv.length!==3){console.error('Use node scripts/autostart-windows.mjs --enable ou --disable. Nada foi alterado.');process.exitCode=1;}
 else configureAutostart({enable:arg==='--enable'}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
