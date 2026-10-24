import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createProcessManager } from '../desktop/processes.mjs';
import { open, realpath, lstat, readdir, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { throwIfAborted } from '../core/diagnostics.mjs';

const actions = new Set(['files_list','files_read','files_create','files_move','files_open']);
const blocked = /^(?:\..*|node_modules|windows|appdata|credentials?|secrets?|id_rsa|id_ed25519)$/i;
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const documents = new Set(['.pdf','.docx','.xlsx','.pptx']);
const extensions = new Set(['.txt','.md','.csv','.json']);
export function validRelativeFile(value, { directory = false, document = false } = {}) {
  if (directory && value === '') return true;
  return typeof value === 'string' && value.length > 0 && value.length <= 240 && !path.posix.isAbsolute(value) &&
    !/[\\:<>|?*\x00-\x1f\x7f]/.test(value) && value.split('/').every(part => part && part !== '..' && !blocked.test(part) && !reserved.test(part) && !/[. ]$/.test(part)) &&
    (directory || extensions.has(path.posix.extname(value).toLowerCase()) || (document && documents.has(path.posix.extname(value).toLowerCase())));
}
export function validateFileAction(action, params) {
  if (!actions.has(action) || !params || typeof params !== 'object' || Array.isArray(params)) return null;
  const keys=action === 'files_create' ? ['path','content'] : action === 'files_move' ? ['path','destination'] : ['path'];
  if(Object.keys(params).length!==keys.length || keys.some(key=>!Object.hasOwn(params,key)))return null;
  if(!validRelativeFile(params.path,{directory:action==='files_list',document:action==='files_open'}))return null;
  if(action==='files_create' && (typeof params.content!=='string' || Buffer.byteLength(params.content)>65536))return null;
  if(action==='files_move' && !validRelativeFile(params.destination))return null;
  return {action,params:{...params}};
}

// Never falls back to the user's home directory. The root is explicit configuration.
export function createFileTools({ root, signal, platform=process.platform, env=process.env, processManager=createProcessManager(), spawnProcess=spawn } = {}) {
  async function resolve(relative, { directory = false, creating = false, document = false } = {}) {
    throwIfAborted(signal);
    if(!root)throw new Error('FILES_ROOT_REQUIRED');
    if(!validRelativeFile(relative,{directory,document}))throw new Error('FILE_PATH_REJECTED');
    const base=await realpath(root);
    const segments=relative ? relative.split('/') : [];
    let target=base;
    for(let index=0;index<segments.length;index++){
      target=path.join(target,segments[index]);
      if(creating && index===segments.length-1)break;
      const stat=await lstat(target);
      if(stat.isSymbolicLink())throw new Error('FILE_SYMLINK_REJECTED');
      if(index<segments.length-1&&!stat.isDirectory())throw new Error('FILE_PATH_REJECTED');
      const real=await realpath(target);
      if(real!==base&&!real.startsWith(base+path.sep))throw new Error('FILE_PATH_REJECTED');
    }
    return target;
  }
  return {
    async run(action,params){
      const canonical=validateFileAction(action,params);
      if(!canonical)throw new Error('ACTION_NOT_ALLOWED');
      const target=await resolve(params.path,{directory:action==='files_list',creating:action==='files_create',document:action==='files_open'});
      if(action==='files_open'){
        if(platform!=='win32')throw new Error('WINDOWS_ONLY');
        const stat=await lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink>1)throw new Error('FILE_PATH_REJECTED');
        const executable=path.win32.join(env.WINDIR||'C:\\Windows','System32','rundll32.exe');
        await processManager.run(executable,['url.dll,FileProtocolHandler',pathToFileURL(target).href],{env,signal,spawnProcess,timeoutMs:10000});
        return {ok:true,status:'requested',verified:false,message:'Solicitei a abertura do documento ao Windows.'};
      }
      if(action==='files_list'){
        const entries=await readdir(target,{withFileTypes:true});
        return {ok:true,status:'completed',verified:true,items:entries.filter(entry=>!entry.isSymbolicLink()&&!blocked.test(entry.name)&&(entry.isDirectory()||(extensions.has(path.extname(entry.name).toLowerCase())||documents.has(path.extname(entry.name).toLowerCase())))).slice(0,200).map(entry=>({name:entry.name,type:entry.isDirectory()?'directory':'file'}))};
      }
      if(action==='files_read'){
        const handle=await open(target,constants.O_RDONLY | (constants.O_NOFOLLOW||0));
        try{
          const stat=await handle.stat();if(!stat.isFile()||stat.nlink>1||stat.size>65536)throw new Error('FILE_SIZE_REJECTED');
          const buffer=Buffer.alloc(65537);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
          if(bytesRead>65536)throw new Error('FILE_SIZE_REJECTED');
          const content=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,bytesRead));
          throwIfAborted(signal);
          return {ok:true,status:'completed',verified:true,content};
        }finally{await handle.close();}
      }
      if(action==='files_create'){
        throwIfAborted(signal);
        const handle=await open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW||0),0o600);
        try{await handle.writeFile(params.content,'utf8');await handle.sync();}finally{await handle.close();}
        return {ok:true,status:'completed',verified:true,message:`Arquivo criado: ${params.path}`};
      }
      const destination=await resolve(params.destination,{creating:true});
      const stat=await lstat(target);if(!stat.isFile()||stat.nlink>1||stat.isSymbolicLink())throw new Error('FILE_PATH_REJECTED');
      throwIfAborted(signal);
      // link is exclusive: an existing destination is never overwritten. No recursive deletion.
      await link(target,destination);
      try{await unlink(target);}catch(error){await unlink(destination).catch(()=>{});throw error;}
      return {ok:true,status:'completed',verified:true,message:`Arquivo movido para ${params.destination}`};
    },
  };
}
