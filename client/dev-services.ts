import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import type { Plugin } from 'vite';

const root = path.resolve(__dirname, '..');

const ollamaExe = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama.exe');

const services: { name: string; port: number; cwd: string; cmd: string; env?: Record<string, string> }[] = [
  // Local LLM (Llama 3.2) + embeddings for the CDS. Bound to loopback only.
  { name: 'ollama', port: 11434, cwd: '.', cmd: `"${ollamaExe}" serve`, env: { OLLAMA_HOST: '127.0.0.1:11434' } },
  { name: 'express', port: 5000, cwd: 'server', cmd: 'npx ts-node --transpile-only src/index.ts' },
  { name: 'portal', port: 5175, cwd: 'patient-portal', cmd: 'npm run dev' },
  { name: 'cds', port: 8000, cwd: 'cds-service', cmd: '.venv\\Scripts\\python.exe -m uvicorn main:app --reload --port 8000' },
];

const inUse = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });

// Starts the API, patient portal and CDS service alongside the staff client's
// dev server, skipping any whose port is already taken.
export function devServices(): Plugin {
  const children: ChildProcess[] = [];
  return {
    name: 'ses-dev-services',
    apply: 'serve',
    async configureServer(server) {
      for (const svc of services) {
        if (await inUse(svc.port)) {
          console.log(`[ses] ${svc.name} already running on :${svc.port}`);
          continue;
        }
        const child = spawn(svc.cmd, {
          cwd: path.join(root, svc.cwd), shell: true, stdio: 'inherit',
          env: svc.env ? { ...process.env, ...svc.env } : process.env,
        });
        child.on('exit', (code) => console.log(`[ses] ${svc.name} exited (${code})`));
        children.push(child);
        console.log(`[ses] starting ${svc.name} on :${svc.port}`);
      }
      const stop = () => {
        for (const c of children) {
          if (c.pid) spawn('taskkill', ['/pid', String(c.pid), '/t', '/f'], { stdio: 'ignore' });
        }
      };
      server.httpServer?.once('close', stop);
      process.once('exit', stop);
      process.once('SIGINT', () => { stop(); process.exit(); });
    },
  };
}
