export function createToolsPanel({ request, onError, onProposal }) {
  const $ = id => document.getElementById(id);
  let version = 0;
  const run = work => Promise.resolve().then(work).catch(onError);
  async function refreshMemory() {
    const current = version;
    const { items } = await request('/api/memory');
    if (current !== version || $('tools-panel').hidden) return;
    $('memory-items').replaceChildren();
    for (const item of items) {
      const row = document.createElement('article');
      const text = document.createElement('p');
      text.textContent = `${item.key}: ${item.value}`;
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Editar';
      edit.onclick = () => { $('memory-key').value = item.key; $('memory-value').value = item.value; $('memory-value').focus(); };
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Esquecer';
      remove.onclick = () => run(async () => {
        if (!window.confirm(`Esquecer a informação “${item.key}”?`)) return;
        await request('/api/memory/delete', { key: item.key }); await refreshMemory();
      });
      row.append(text, edit, remove); $('memory-items').append(row);
    }
    if (!items.length) $('memory-items').textContent = 'Nenhuma informação salva.';
  }
  $('tool-form').onsubmit = event => {
    event.preventDefault();
    void run(async () => {
      const action=$('tool-action').value;
      const app=$('tool-app').value;
      const params=['list_apps','restart_windows','shutdown_windows'].includes(action)?{}
        :action==='type_text'?{app,control:$('tool-control').value,text:$('tool-text').value}
        :action==='click_control'?{app,control:$('tool-control').value}
        :action==='keyboard_shortcut'?{app,shortcut:$('tool-shortcut').value}
        :action==='files_create'?{path:$('tool-path').value,content:$('tool-text').value}
        :action==='files_move'?{path:$('tool-path').value,destination:$('tool-destination').value}
        :action.startsWith('files_')?{path:$('tool-path').value}
        :{app};
      await request('/api/proposals',{action,params});
      $('tool-result').textContent='Proposta criada. Revise os detalhes na seção Aprovações de ações.';
      await onProposal();
    });
  };
  const updateToolFields=()=>{
    const action=$('tool-action').value;
    for(const [id,show] of [
      ['tool-app-label',!action.startsWith('files_')&&!['list_apps','restart_windows','shutdown_windows'].includes(action)],
      ['tool-control-label',['click_control','type_text'].includes(action)],
      ['tool-text-label',['type_text','files_create'].includes(action)],
      ['tool-shortcut-label',action==='keyboard_shortcut'],
      ['tool-path-label',action.startsWith('files_')],['tool-destination-label',action==='files_move'],
    ])$(id).hidden=!show;
  };
  $('tool-action').onchange=updateToolFields;updateToolFields();
  $('memory-refresh').onclick = () => run(refreshMemory);
  $('memory-form').onsubmit = event => {
    event.preventDefault();
    void run(async () => {
      await request('/api/memory', { key: $('memory-key').value.trim(), value: $('memory-value').value.trim() });
      $('memory-form').reset(); await refreshMemory();
    });
  };
  $('diagnostics-refresh').onclick = () => run(async () => {
    const current = version;
    const result = await request('/api/diagnostics');
    if (current !== version || $('tools-panel').hidden) return;
    const flags = result.providers;
    $('diagnostics-output').textContent = [
      `Servidor: ${result.state} · ${result.platform} · Node ${result.nodeVersion}`,
      `Gemini: ${flags.geminiConfigured ? 'configurado' : 'não configurado'}`,
      `OpenRouter: ${flags.openrouterConfigured ? 'configurado' : 'não configurado'}`,
      `OpenAI: ${flags.openaiEnabled && flags.openaiConfigured ? 'habilitado e configurado' : 'indisponível/desabilitado'}`,
      'Configuração presente não comprova autenticação ou disponibilidade do provedor.',
      ...result.voice.map(item => `${item.occurredAt} · ${item.stage} · ${item.code}${item.hresult ? ` · ${item.hresult}` : ''}`),
      ...(!result.voice.length ? ['Nenhuma falha de voz registrada.'] : []),
    ].join('\n');
  });
  return {
    showResult(result) { $('tool-result').textContent=result.content!==undefined?result.content:JSON.stringify(result.items,null,2); $('tool-details').open=true; },
    show() { version++; $('tools-panel').hidden = false; },
    hide() { version++; $('tools-panel').hidden = true; $('memory-items').replaceChildren(); $('memory-form').reset(); $('diagnostics-output').textContent = ''; $('tool-result').textContent=''; $('tool-form').reset();updateToolFields(); },
  };
}
