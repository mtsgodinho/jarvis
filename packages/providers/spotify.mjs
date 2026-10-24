import { abortable, throwIfAborted } from '../core/diagnostics.mjs';
export function createSpotifyPlayer({token=process.env.SPOTIFY_ACCESS_TOKEN,deviceId=process.env.SPOTIFY_DEVICE_ID,fetchImpl=globalThis.fetch}={}){
  async function request(path,{method='GET',body,signal}={}){
    if(!token)throw Object.assign(new Error('Conecte uma conta Spotify e configure um token OAuth com permissões de reprodução.'),{code:'SPOTIFY_NOT_CONFIGURED'});
    const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000);
    const response=await abortable(fetchImpl(`https://api.spotify.com/v1/${path}`,{method,redirect:'error',signal:combined,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),combined);
    if(!response.ok){const code=response.status===401?'SPOTIFY_AUTH_REQUIRED':response.status===403?'SPOTIFY_PREMIUM_OR_SCOPE_REQUIRED':response.status===404?'SPOTIFY_DEVICE_REQUIRED':'SPOTIFY_UNAVAILABLE';throw Object.assign(new Error(code),{code});}
    if(response.status===204)return null;
    return abortable(response.json(),combined);
  }
  return {
    async play(query,{signal}={}){
      if(typeof query!=='string'||!query.trim()||query.length>240||/[\x00-\x1f\x7f]/.test(query))throw new Error('ACTION_NOT_ALLOWED');
      const result=await request(`search?${new URLSearchParams({q:query,type:'track',limit:'1'})}`,{signal});
      const track=result?.tracks?.items?.[0];
      if(!track||!/^spotify:track:[A-Za-z0-9]{22}$/.test(track.uri))throw Object.assign(new Error('SPOTIFY_TRACK_NOT_FOUND'),{code:'SPOTIFY_TRACK_NOT_FOUND'});
      const devices=await request('me/player/devices',{signal});
      const device=devices?.devices?.find(item=>!item.is_restricted&&(deviceId?item.id===deviceId:item.is_active));
      if(!device||typeof device.id!=='string')throw Object.assign(new Error('SPOTIFY_DEVICE_REQUIRED'),{code:'SPOTIFY_DEVICE_REQUIRED'});
      throwIfAborted(signal);
      await request(`me/player/play?${new URLSearchParams({device_id:device.id})}`,{method:'PUT',body:{uris:[track.uri]},signal});
      const playback=await request('me/player',{signal});
      const verified=playback?.is_playing===true&&playback.item?.uri===track.uri&&playback.device?.id===device.id;
      return {ok:true,status:verified?'completed':'requested',verified,message:verified?`Reprodução confirmada no Spotify: ${track.name}.`:'Solicitei a reprodução ao Spotify, mas ela ainda não foi confirmada.'};
    },
  };
}
