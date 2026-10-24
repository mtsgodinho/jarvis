import path from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createProcessManager } from './processes.mjs';

export const WINDOW_APPS = Object.freeze({ chrome: 'chrome', edge: 'msedge', notepad: 'notepad', calculator: 'CalculatorApp', paint: 'mspaint', spotify: 'Spotify', vscode: 'Code' });
const operations = new Set(['list_apps', 'focus_window', 'minimize_window', 'maximize_window', 'close_app', 'click_control', 'type_text', 'keyboard_shortcut', 'restart_windows', 'shutdown_windows']);
const shortcuts = Object.freeze({ copy: '^c', paste: '^v', select_all: '^a', save: '^s', find: '^f' });
export function validateWindowAction(action, params) {
  if (!operations.has(action) || !params || typeof params !== 'object' || Array.isArray(params)) return null;
  const keys = ['list_apps','restart_windows','shutdown_windows'].includes(action) ? []
    : action === 'type_text' ? ['app','control','text'] : action === 'click_control' ? ['app','control']
      : action === 'keyboard_shortcut' ? ['app','shortcut'] : ['app'];
  if (Object.keys(params).length !== keys.length || keys.some(key => !Object.hasOwn(params,key))) return null;
  if (keys.includes('app') && !Object.hasOwn(WINDOW_APPS,params.app)) return null;
  if (keys.includes('control') && (typeof params.control !== 'string' || !params.control.trim() || params.control.length > 120 || /[\x00-\x1f\x7f]/.test(params.control))) return null;
  if (keys.includes('text') && (typeof params.text !== 'string' || !params.text || params.text.length > 2000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(params.text))) return null;
  if (keys.includes('shortcut') && !Object.hasOwn(shortcuts,params.shortcut)) return null;
  return { action, params: { ...params } };
}

export async function runWindowAction(action, params, { platform = process.platform, env = process.env, processManager = createProcessManager(), signal, spawnProcess = spawn, exists = existsSync } = {}) {
  const validated = validateWindowAction(action,params);
  if (!validated) throw new Error('ACTION_NOT_ALLOWED');
  if (platform !== 'win32') throw new Error('WINDOWS_ONLY');
  const windows = env.WINDIR || 'C:\\Windows';
  if (['restart_windows','shutdown_windows'].includes(action)) {
    const executable = path.win32.join(windows,'System32','shutdown.exe');
    if (!exists(executable)) throw new Error('EXECUTABLE_NOT_FOUND');
    await processManager.run(executable,[action === 'restart_windows' ? '/r' : '/s','/t','0'],{env,signal,spawnProcess,timeoutMs:10000});
    return { ok:true,status:'requested',verified:false,message:'Solicitação de energia enviada ao Windows.' };
  }
  const payload = Buffer.from(JSON.stringify({ ...validated.params, process: WINDOW_APPS[params.app], shortcut:shortcuts[params.shortcut] }), 'utf8').toString('base64');
  // Only encoded data is substituted. All executable statements are fixed.
  const script = `$ErrorActionPreference='Stop';
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class JarvisWindow {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int cmd);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint msg,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@;
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json;
$action='${action}';
$targets=@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 });
if($action -eq 'list_apps') {
 $allowed=@('chrome','msedge','notepad','CalculatorApp','mspaint','Spotify','Code');
 $items=@($targets | Where-Object {$allowed -contains $_.ProcessName} | ForEach-Object { @{app=$_.ProcessName;title=$_.MainWindowTitle} });
 @{ok=$true;status='completed';verified=$true;items=$items}|ConvertTo-Json -Depth 4 -Compress;exit 0;
}
$target=@($targets | Where-Object {$_.ProcessName -eq $p.process});
if($target.Count -ne 1){throw 'WINDOW_NOT_UNIQUE'};
$h=$target[0].MainWindowHandle;
if($action -eq 'close_app') {if(-not [JarvisWindow]::PostMessage($h,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'WINDOW_REQUEST_FAILED'}}
elseif($action -eq 'minimize_window'){[void][JarvisWindow]::ShowWindowAsync($h,6)}
elseif($action -eq 'maximize_window'){[void][JarvisWindow]::ShowWindowAsync($h,3)}
else {
 if(-not [JarvisWindow]::SetForegroundWindow($h)){throw 'FOCUS_FAILED'};
 if([JarvisWindow]::GetForegroundWindow() -ne $h){throw 'FOCUS_FAILED'};
 if($action -eq 'keyboard_shortcut') {Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait($p.shortcut)}
 elseif($action -eq 'click_control' -or $action -eq 'type_text') {
  Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes;
  $root=[System.Windows.Automation.AutomationElement]::FromHandle($h);
  $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$p.control);
  $matches=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition);
  if($matches.Count -ne 1){throw 'CONTROL_NOT_UNIQUE'};
  $control=$matches.Item(0);
  if(-not $control.Current.IsEnabled -or $control.Current.IsPassword){throw 'CONTROL_NOT_ALLOWED'};
  if($action -eq 'click_control'){$pattern=$control.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern);$pattern.Invoke()}
  else {$pattern=$control.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);if($pattern.Current.IsReadOnly){throw 'CONTROL_READ_ONLY'};$pattern.SetValue($p.text)}
 }
}
@{ok=$true;status='requested';verified=$false}|ConvertTo-Json -Compress;
`;
  const executable = path.win32.join(windows,'System32','WindowsPowerShell','v1.0','powershell.exe');
  if (!exists(executable)) throw new Error('EXECUTABLE_NOT_FOUND');
  const result = await processManager.run(executable,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env,signal,spawnProcess,timeoutMs:10000,captureOutput:true});
  let response;
  try { response=JSON.parse(result.stdout.trim()); } catch { throw new Error('WINDOW_RESULT_INVALID'); }
  if (response.ok!==true) throw new Error('WINDOW_ACTION_FAILED');
  return response;
}
