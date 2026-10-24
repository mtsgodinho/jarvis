import { abortable, throwIfAborted } from '../core/diagnostics.mjs';
const hosts = new Set(['pt.wikipedia.org','geocoding-api.open-meteo.com','api.open-meteo.com','g1.globo.com']);
export const RESEARCH_DOMAINS = [...hosts];
export function detectResearch(message) {
  if(typeof message!=='string')return null;
  const text=message.trim().replace(/^(?:jarvis[,\s]+)?/i,'').replace(/[.!?]+$/,'');
  const weather=/^(?:como (?:está|esta) (?:o )?tempo|(?:qual (?:é|e) )?(?:a )?(?:previsão|previsao)(?: do tempo)?) (?:em|para) (.{1,100})$/iu.exec(text);
  if(weather)return {kind:'weather',query:weather[1].trim()};
  if(/^(?:quais (?:são|sao) (?:as )?|(?:me (?:diga|mostre) )?)(?:notícias|noticias)(?: de hoje| atuais| do dia)?$/iu.test(text))return {kind:'news'};
  const search=/^(?:pesquise|pesquisa|consulte|busque) (?:na internet|na web) (?:sobre )?(.{1,180})$/iu.exec(text);
  return search?{kind:'search',query:search[1].trim()}:null;
}
export function createResearch({fetchImpl=globalThis.fetch,now=()=>new Date()}={}){
  async function request(url,signal,kind='json'){
    const target=new URL(url);
    if(target.protocol!=='https:' || !hosts.has(target.hostname) || target.port || target.username || target.password)throw new Error('RESEARCH_DESTINATION_REJECTED');
    const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000);
    const response=await abortable(fetchImpl(target.href,{redirect:'error',signal:combined,headers:{Accept:kind==='json'?'application/json':'application/rss+xml, application/xml, text/xml'}}),combined);
    if(!response.ok)throw new Error('RESEARCH_UNAVAILABLE');
    const reader=response.body.getReader();let size=0;const chunks=[];
    try{
      while(true){const part=await abortable(reader.read(),combined);if(part.done)break;size+=part.value.length;if(size>1024*1024)throw new Error('RESEARCH_RESPONSE_LIMIT');chunks.push(Buffer.from(part.value));}
    }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    throwIfAborted(signal);const text=Buffer.concat(chunks).toString('utf8');return kind==='json'?JSON.parse(text):text;
  }
  return {
    async run({kind,query}, {signal}={}){
      let sources=[],lines=[];
      if(kind==='weather'){
        if(typeof query!=='string'||!query.trim()||query.length>100)throw new Error('RESEARCH_QUERY_INVALID');
        const geocoding=new URL('https://geocoding-api.open-meteo.com/v1/search');geocoding.search=new URLSearchParams({name:query,count:'1',language:'pt',format:'json'});
        const location=(await request(geocoding,signal)).results?.[0];
        if(!location||!Number.isFinite(location.latitude)||!Number.isFinite(location.longitude))throw new Error('RESEARCH_LOCATION_NOT_FOUND');
        const forecast=new URL('https://api.open-meteo.com/v1/forecast');forecast.search=new URLSearchParams({latitude:String(location.latitude),longitude:String(location.longitude),current:'temperature_2m,relative_humidity_2m,wind_speed_10m',timezone:'auto'});
        const data=await request(forecast,signal);const current=data.current;
        if(!current||!Number.isFinite(current.temperature_2m)||!current.time)throw new Error('RESEARCH_UNAVAILABLE');
        lines=[`${location.name}${location.admin1?`, ${location.admin1}`:''}${location.country?`, ${location.country}`:''}: ${current.temperature_2m} °C; umidade ${current.relative_humidity_2m}%; vento ${current.wind_speed_10m} km/h.`, `Dados de ${current.time} (${data.timezone||'horário da fonte'}), sujeitos a atualização.`];
        sources=[{title:'Open-Meteo — previsão',url:forecast.href},{title:'Open-Meteo — localização',url:geocoding.href}];
      }else if(kind==='search'){
        if(typeof query!=='string'||!query.trim()||query.length>180)throw new Error('RESEARCH_QUERY_INVALID');
        const url=new URL('https://pt.wikipedia.org/w/api.php');url.search=new URLSearchParams({action:'query',generator:'search',gsrsearch:query,gsrlimit:'3',prop:'extracts|info',exintro:'1',explaintext:'1',exchars:'500',inprop:'url',format:'json'});
        const pages=Object.values((await request(url,signal)).query?.pages||{}).sort((a,b)=>(a.index||0)-(b.index||0));
        for(const page of pages){
          const link=new URL(page.fullurl||`https://pt.wikipedia.org/?curid=${page.pageid}`);
          if(link.protocol!=='https:'||link.hostname!=='pt.wikipedia.org')continue;
          lines.push(`${page.title}: ${String(page.extract||'Sem resumo disponível.').slice(0,600)}`);sources.push({title:page.title,url:link.href});
        }
        if(!sources.length)throw new Error('RESEARCH_NO_RESULTS');
        lines.unshift('Consulta enciclopédica à Wikipédia; não é uma busca completa da web nem garantia de informação atual.');
      }else if(kind==='news'){
        const url='https://g1.globo.com/rss/g1/';const xml=await request(url,signal,'xml');
        const decode=value=>String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
        for(const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)){
          const field=name=>new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,'i').exec(match[1])?.[1];
          const title=decode(field('title')||'').slice(0,250);let link;
          try{link=new URL(decode(field('link')||''));}catch{continue;}
          if(!title||link.protocol!=='https:'||!['g1.globo.com'].includes(link.hostname))continue;
          const date=decode(field('pubDate')||'data não informada');
          lines.push(`${title} — ${date}`);sources.push({title,url:link.href});if(sources.length===5)break;
        }
        if(!sources.length)throw new Error('RESEARCH_NO_RESULTS');
        lines.unshift('Manchetes disponíveis no feed G1; confira a data de cada publicação. Não foram consultados os textos completos das matérias.');
      }else throw new Error('RESEARCH_QUERY_INVALID');
      const consultedAt=now().toISOString();
      return {reply:[...lines,`Consultado em ${consultedAt}.`,...sources.map(source=>`Fonte: ${source.title} — ${source.url}`)].join('\n\n'),sources,consultedAt};
    },
  };
}
