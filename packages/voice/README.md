A voz do navegador está em `apps/panel/voice-session.js` e `voice-speech.js`; a voz residente está em `packages/resident-voice`, com helper Windows .NET 10/WinRT. Este adaptador de voz genérico permanece reservado; LiveKit não foi habilitado.

Reconhecimento e TTS usam consentimento explícito e operação half-duplex para evitar eco. Voz masculina pt-BR é preferida quando disponível. Interrupção do TTS pelo próprio microfone permanece sem suporte; há controle pelo painel. Validação física e seleção do dispositivo padrão devem ocorrer no Windows. Veja o guia de uso.
