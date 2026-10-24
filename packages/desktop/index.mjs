import { createSpotifyPlayer } from '../providers/spotify.mjs';
import { createFileTools, validateFileAction } from '../files/index.mjs';
import { runWindowAction, validateWindowAction } from './windows-control.mjs';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { findChromeProfile } from '../core/chrome-profiles.mjs';
import { LOCAL_APPS, LOCAL_FOLDERS, LOCAL_SITES, localActionConfirmation, validateLocalAction } from '../contracts/local-actions.mjs';
import { createProcessManager } from './processes.mjs';
import { abortable, throwIfAborted } from '../core/diagnostics.mjs';

const MEDIA_KEYS = Object.freeze({
  volume_up: 0xaf,
  volume_down: 0xae,
  mute: 0xad,
  unmute: 0xad,
  media_play_pause: 0xb3,
  media_next: 0xb0,
  media_previous: 0xb1,
});

const VOLUME_ACTIONS = new Set(['set_volume','volume_up','volume_down','mute','unmute']);

function volumeControlArgs(action, percent) {
  const volumePercent = Number.isInteger(percent) && percent >= 0 && percent <= 100 ? percent : 0;
  const script = `$ErrorActionPreference = 'Stop';
try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Reflection;
public static class JarvisCoreAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] private class MMDeviceEnumeratorCom {}
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")] private interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out object devices); [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
  }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("D666063F-1587-4E43-81F1-B948E807363F")] private interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsctx, IntPtr activationParams, [MarshalAs(UnmanagedType.Interface)] out IAudioEndpointVolume endpoint);
  }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("5CDF2C82-841E-4546-9722-0CF74078229A")] private interface IAudioEndpointVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr notify); [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify); [PreserveSig] int GetChannelCount(out uint count);
    [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid context); [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
    [PreserveSig] int GetMasterVolumeLevel(out float level); [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, ref Guid context); [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
    [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level); [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context); [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }
  public static float ReadPercent() { IAudioEndpointVolume v=GetVolume(); float p; Check(v.GetMasterVolumeLevelScalar(out p)); return p*100.0f; }
  public static void SetPercent(float p) { IAudioEndpointVolume v=GetVolume(); Guid g=Guid.Empty; Check(v.SetMasterVolumeLevelScalar(p/100.0f,ref g)); float actual; Check(v.GetMasterVolumeLevelScalar(out actual)); if(Math.Abs(actual*100.0f-p)>1.0f) throw new Exception("VOLUME_NOT_CONFIRMED"); }
  public static void SetMuted(bool m) { IAudioEndpointVolume v=GetVolume(); Guid g=Guid.Empty; Check(v.SetMute(m,ref g)); bool actual; Check(v.GetMute(out actual)); if(actual!=m) throw new Exception("MUTE_NOT_CONFIRMED"); }
  private static IAudioEndpointVolume GetVolume() { IMMDeviceEnumerator e=(IMMDeviceEnumerator)new MMDeviceEnumeratorCom(); IMMDevice d; Check(e.GetDefaultAudioEndpoint(0,1,out d)); Guid i=new Guid("5CDF2C82-841E-4546-9722-0CF74078229A"); IAudioEndpointVolume v; Check(d.Activate(ref i,23,IntPtr.Zero,out v)); return v; }
  private static void Check(int hr) { if(hr<0) Marshal.ThrowExceptionForHR(hr); }
}
'@;
  switch ('${action}') {
    'set_volume' { [JarvisCoreAudio]::SetPercent(${volumePercent}) }
    'volume_up' { $v=[Math]::Min(100,[JarvisCoreAudio]::ReadPercent()+10); [JarvisCoreAudio]::SetPercent($v) }
    'volume_down' { $v=[Math]::Max(0,[JarvisCoreAudio]::ReadPercent()-10); [JarvisCoreAudio]::SetPercent($v) }
    'mute' { [JarvisCoreAudio]::SetMuted($true) }
    'unmute' { [JarvisCoreAudio]::SetMuted($false) }
    default { throw 'ACTION_NOT_ALLOWED' }
  }
  exit 0
} catch { exit 1 }`;
  return ['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')];
}

async function runVolumeAction(action, validatedParams, { platform, env, exists, spawnProcess, volumeController, signal, processManager }) {
  throwIfAborted(signal);
  if (volumeController) {
    if (action === 'set_volume') await volumeController.setVolume(validatedParams.percent);
    else if (action === 'volume_up') await volumeController.adjustVolume(10);
    else if (action === 'volume_down') await volumeController.adjustVolume(-10);
    else if (action === 'mute') await volumeController.setMuted(true);
    else await volumeController.setMuted(false);
    return { ok: true, status: 'completed', verified: true };
  }
  if (platform !== 'win32') throw new Error('WINDOWS_ONLY');
  const executable = path.win32.join(env.WINDIR || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  if (!exists(executable)) throw new Error('EXECUTABLE_NOT_FOUND');
  try {
    return await processManager.run(executable,volumeControlArgs(action,validatedParams.percent),{
      spawnProcess,env,signal,timeoutMs:10000,
    });
  } catch(error) {
    if(error.code==='PROCESS_FAILED')throw new Error('VOLUME_CONTROL_FAILED');
    throw error;
  }
}

function chromeCandidates(env) {
  return [
    path.win32.join(env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.win32.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.win32.join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
}

function appCandidates(app, env) {
  const windows = env.WINDIR || 'C:\\Windows';
  const explorer = path.win32.join(windows, 'explorer.exe');
  const system32 = path.win32.join(windows, 'System32');
  const programFiles = env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = env.LOCALAPPDATA || '';
  const roaming = env.APPDATA || '';
  const candidates = {
    chrome: chromeCandidates(env),
    edge: [
      path.win32.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.win32.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
    explorer: [explorer],
    notepad: [path.win32.join(system32, 'notepad.exe')],
    calculator: [path.win32.join(system32, 'calc.exe')],
    settings: [explorer],
    paint: [path.win32.join(system32, 'mspaint.exe')],
    spotify: [
      path.win32.join(roaming, 'Spotify', 'Spotify.exe'),
      path.win32.join(local, 'Programs', 'Spotify', 'Spotify.exe'),
      path.win32.join(programFiles, 'Spotify', 'Spotify.exe'),
      path.win32.join(local, 'Microsoft', 'WindowsApps', 'Spotify.exe'),
    ],
    vscode: [
      path.win32.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.win32.join(programFiles, 'Microsoft VS Code', 'Code.exe'),
      path.win32.join(programFilesX86, 'Microsoft VS Code', 'Code.exe'),
    ],
  };
  return candidates[app] ?? [];
}

function powershellMediaArgs(key) {
  const script = `$ErrorActionPreference='Stop'; try { Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class JarvisMediaKey { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }'; [JarvisMediaKey]::keybd_event(${key}, 0, 0, [UIntPtr]::Zero); [JarvisMediaKey]::keybd_event(${key}, 0, 2, [UIntPtr]::Zero); exit 0 } catch { exit 1 }`;
  return ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

function youtubeResultsUrl(query) {
  return `https://www.youtube.com/results?${new URLSearchParams({ search_query: query })}`;
}

function firstYoutubeVideoId(html) {
  return /"videoRenderer"\s*:\s*\{\s*"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/.exec(html)?.[1] ?? null;
}

export async function runDesktopAction(action, {
  profileName,
  app,
  folder,
  site,
  query,
  percent,
  platform = process.platform,
  env = process.env,
  homeDirectory = homedir(),
  spawnProcess = spawn,
  exists = existsSync,
  fetchPage = globalThis.fetch,
  volumeController,
} = {}, { signal, processManager = createProcessManager() } = {}) {
  throwIfAborted(signal);
  if(action==='play_spotify'){
    const valid=validateLocalAction(action,{query});if(!valid)throw new Error('ACTION_NOT_ALLOWED');
    return createSpotifyPlayer({token:env.SPOTIFY_ACCESS_TOKEN,deviceId:env.SPOTIFY_DEVICE_ID,fetchImpl:fetchPage}).play(valid.params.query,{signal});
  }
  const fileAction = validateFileAction(action,arguments[1] || {});
  if(fileAction)return createFileTools({root:env.JARVIS_FILES_ROOT,signal,processManager,env,platform,spawnProcess}).run(action,fileAction.params);
  const windowAction = validateWindowAction(action, arguments[1] || {});
  if (windowAction) return runWindowAction(action,windowAction.params,{signal,processManager});
  if (VOLUME_ACTIONS.has(action)) {
    const allowedOptions = new Set(['platform','env','exists','spawnProcess','volumeController']);
    if (action === 'set_volume') allowedOptions.add('percent');
    if (Object.keys(arguments[1] || {}).some(key => !allowedOptions.has(key))) throw new Error('ACTION_NOT_ALLOWED');
  }
  if (platform !== 'win32' && !(VOLUME_ACTIONS.has(action) && volumeController)) throw new Error('WINDOWS_ONLY');
  if (action === 'open_chrome') {
    const profile = profileName === undefined ? null : findChromeProfile(profileName);
    if (profileName !== undefined && !profile) throw new Error('PROFILE_NOT_ALLOWED');
    const executable = chromeCandidates(env).find(exists);
    if (!executable) throw new Error('CHROME_NOT_FOUND');
    await processManager.run(executable, profile ? [`--profile-directory=${profile.directory}`] : [], {
      spawnProcess,env,signal,handoff:true,windowsHide:true,
    });
    return { ok: true, status:'launched', verified:false, message: profile ? `Abrindo o Chrome no perfil ${profile.name}.` : 'Abrindo o Chrome, Mateus.' };
  }

  const params = { app, folder, site, query };
  const volumeParams = action === 'set_volume' ? { percent } : {};
  const actionParams = action === 'set_volume' ? volumeParams : action === 'open_app' ? { app } : action === 'open_folder' ? { folder } :
    action === 'open_site' ? { site } : action === 'search_google' || action === 'search_youtube' || action === 'play_youtube' ? { query } : {};
  const validated = validateLocalAction(action, actionParams);
  if (!validated) throw new Error('ACTION_NOT_ALLOWED');

  if (VOLUME_ACTIONS.has(action)) return runVolumeAction(action,validated.params,{platform,env,exists,spawnProcess,volumeController,signal,processManager});

  const windows = env.WINDIR || 'C:\\Windows';
  const explorer = path.win32.join(windows, 'explorer.exe');
  let executable;
  let args = [];
  let resultMessage;
  if (action === 'open_app') {
    if (!Object.hasOwn(LOCAL_APPS, params.app)) throw new Error('APP_NOT_ALLOWED');
    executable = appCandidates(params.app, env).find(exists);
    if (!executable) throw new Error('APP_NOT_FOUND');
    if (params.app === 'settings') args = ['ms-settings:'];
  } else if (action === 'open_folder') {
    if (!Object.hasOwn(LOCAL_FOLDERS, params.folder)) throw new Error('FOLDER_NOT_ALLOWED');
    const home = env.USERPROFILE || homeDirectory;
    const folderNames = { desktop: 'Desktop', downloads: 'Downloads', documents: 'Documents', pictures: 'Pictures', videos: 'Videos', music: 'Music' };
    args = [path.win32.join(home, folderNames[params.folder])];
    executable = explorer;
    if (!exists(args[0])) throw new Error('FOLDER_NOT_FOUND');
  } else if (action === 'open_site') {
    if (!Object.hasOwn(LOCAL_SITES, params.site)) throw new Error('SITE_NOT_ALLOWED');
    executable = path.win32.join(windows, 'System32', 'rundll32.exe');
    args = ['url.dll,FileProtocolHandler', LOCAL_SITES[params.site].url];
  } else if (action === 'search_google' || action === 'search_youtube') {
    const validatedQuery = validated.params.query;
    const base = action === 'search_google' ? 'https://www.google.com/search' : 'https://www.youtube.com/results';
    const key = action === 'search_google' ? 'q' : 'search_query';
    executable = path.win32.join(windows, 'System32', 'rundll32.exe');
    args = ['url.dll,FileProtocolHandler', `${base}?${new URLSearchParams({ [key]: validatedQuery })}`];
  } else if (action === 'play_youtube') {
    const resultsUrl = youtubeResultsUrl(validated.params.query);
    let videoId = null;
    try {
      const fetchSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(7000)]):AbortSignal.timeout(7000);
      const response = await abortable(fetchPage(resultsUrl, {
        redirect: 'error',
        signal: fetchSignal,
        headers: { Accept: 'text/html' },
      }),fetchSignal);
      const contentType = response.headers?.get?.('content-type');
      if (response.ok && (!contentType || contentType.includes('text/html'))) {
        const html = await abortable(response.text(),fetchSignal);
        if (html.length <= 5_000_000) videoId = firstYoutubeVideoId(html);
      }
    } catch {throwIfAborted(signal);}

    executable = path.win32.join(windows, 'System32', 'rundll32.exe');
    if (videoId) {
      const watchUrl = new URL('https://www.youtube.com/watch');
      watchUrl.searchParams.set('v', videoId);
      watchUrl.searchParams.set('autoplay', '1');
      args = ['url.dll,FileProtocolHandler', watchUrl.href];
      resultMessage = `Abrindo um vídeo de ${validated.params.query} no YouTube. A reprodução ainda não foi verificada.`;
    } else {
      args = ['url.dll,FileProtocolHandler', resultsUrl];
      resultMessage = `Não consegui iniciar a reprodução automaticamente; abri os resultados de ${validated.params.query} no YouTube para você escolher.`;
    }
  } else if (Object.hasOwn(MEDIA_KEYS, action)) {
    executable = path.win32.join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    args = powershellMediaArgs(MEDIA_KEYS[action]);
  }

  if (!executable) throw new Error('ACTION_NOT_ALLOWED');
  if (!exists(executable)) throw new Error('EXECUTABLE_NOT_FOUND');
  throwIfAborted(signal);
  const helper=Object.hasOwn(MEDIA_KEYS,action)||['open_site','search_google','search_youtube','play_youtube'].includes(action);
  await processManager.run(executable,args,{
    spawnProcess,env,signal,handoff:!helper,windowsHide:Object.hasOwn(MEDIA_KEYS,action),timeoutMs:10000,
  });
  // A successful launcher/media-key process does not prove what happened in
  // another application. Only the native volume controller verifies its result.
  return { ok: true, status:'launched', verified:false, message: resultMessage ?? localActionConfirmation(action, validated.params) };
}
