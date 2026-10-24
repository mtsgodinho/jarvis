import { processEnvironment } from '../security/process-environment.mjs';
import { diagnostic, operationError, throwIfAborted } from '../core/diagnostics.mjs';

export function createProcessManager({ logger = console } = {}) {
  const children = new Map();
  let closing = false;
  let terminationFailed = false;
  return {
    get size() { return children.size; },
    async run(executable, args, {
      spawnProcess, env = process.env, signal, timeoutMs = 10000,
      handoff = false, windowsHide = true,
    }) {
      if (closing) throw operationError('SERVER_STOPPING');
      if (terminationFailed) throw operationError('PROCESS_TERMINATION_FAILED');
      throwIfAborted(signal);
      return new Promise((resolve, reject) => {
        let child, timer, killTimer, settled = false, terminalError;
        const finish = (error, status) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearTimeout(killTimer);
          signal?.removeEventListener('abort', onAbort);
          if (child) children.delete(child);
          diagnostic('process.finished', { state: error ? 'failed' : status }, logger);
          if (error) reject(error);
          else resolve({ ok: true, status, verified: !handoff });
        };
        const terminate = error => {
          if (settled || terminalError) return;
          terminalError = error;
          clearTimeout(timer);
          diagnostic('process.stopping', { code: error.code }, logger);
          try { child.kill('SIGKILL'); } catch {}
          // Kill only our own helper handle, never an executable name / user app tree.
          killTimer = setTimeout(() => {
            terminationFailed = true;
            try { child.kill('SIGKILL'); } catch {}
            child.unref?.();
            finish(operationError('PROCESS_TERMINATION_FAILED'));
          }, 1500);
        };
        const onAbort = () => terminate(signal.reason || operationError('CANCELLED'));
        try {
          child = spawnProcess(executable, args, {
            detached: handoff, stdio: 'ignore', windowsHide, shell: false,
            env: processEnvironment(env),
          });
          children.set(child, { terminate });
          child.once('error', () => finish(terminalError || operationError('PROCESS_START_FAILED')));
          child.once('close', code => finish(terminalError || (code === 0 ? null : operationError('PROCESS_FAILED')), 'completed'));
          child.once('spawn', () => {
            if (terminalError) return;
            if (handoff) {
              child.unref();
              finish(null, 'launched');
            }
          });
          timer = setTimeout(() => terminate(operationError('PROCESS_TIMEOUT')), timeoutMs);
          signal?.addEventListener('abort', onAbort, { once: true });
          if (signal?.aborted) onAbort();
        } catch {
          finish(operationError('PROCESS_START_FAILED'));
        }
      });
    },
    async stop() {
      closing = true;
      for (const { terminate } of children.values()) terminate(operationError('CANCELLED'));
      const deadline = Date.now() + 1800;
      while (children.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      if (terminationFailed) throw operationError('PROCESS_TERMINATION_FAILED');
    },
  };
}
