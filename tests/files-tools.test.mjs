import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFileTools, validateFileAction } from '../packages/files/index.mjs';

test('arquivos exigem pasta autorizada e rejeitam caminhos, segredos e executáveis',async()=>{
  await assert.rejects(createFileTools().run('files_list',{path:''}),/FILES_ROOT_REQUIRED/);
  for(const target of ['../secret.txt','C:/Users/test.txt','/etc/passwd','safe/../../x.txt','.env','pasta/.ssh/key.txt','x.exe','a\\b.txt','CON.txt','pasta./a.txt','NUL/a.txt']){
    assert.equal(validateFileAction('files_read',{path:target}),null,target);
  }
});
test('arquivos: leitura, criação exclusiva, organização e bloqueio de symlinks',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'jarvis-files-'));
  const tools=createFileTools({root});
  try{
    await tools.run('files_create',{path:'nota.txt',content:'Olá, Mateus.'});
    assert.equal((await tools.run('files_read',{path:'nota.txt'})).content,'Olá, Mateus.');
    await assert.rejects(tools.run('files_create',{path:'nota.txt',content:'sobrescrever'}),{code:'EEXIST'});
    await mkdir(path.join(root,'organizado'));
    await tools.run('files_move',{path:'nota.txt',destination:'organizado/nota.txt'});
    assert.equal(await readFile(path.join(root,'organizado/nota.txt'),'utf8'),'Olá, Mateus.');
    await writeFile(path.join(root,'existente.txt'),'original');
    await assert.rejects(tools.run('files_move',{path:'organizado/nota.txt',destination:'existente.txt'}),{code:'EEXIST'});
    await symlink(path.dirname(root),path.join(root,'externo'));
    await assert.rejects(tools.run('files_read',{path:'externo/fora.txt'}),/FILE_SYMLINK_REJECTED/);
    await symlink(path.join(root,'existente.txt'),path.join(root,'atalho.txt'));
    await assert.rejects(tools.run('files_read',{path:'atalho.txt'}),/FILE_SYMLINK_REJECTED/);
    const list=await tools.run('files_list',{path:''});
    assert.equal(list.items.some(item=>item.name==='externo'||item.name==='atalho.txt'),false);
    await writeFile(path.join(root,'grande.txt'),'x'.repeat(65537));
    await assert.rejects(tools.run('files_read',{path:'grande.txt'}),/FILE_SIZE_REJECTED/);
  }finally{await rm(root,{recursive:true,force:true});}
});
