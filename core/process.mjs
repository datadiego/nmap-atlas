/** Procesos hijo con Bun.spawn, sin node:child_process. */

export async function readStream(stream, onChunk) {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      onChunk(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) onChunk(tail);
  } finally {
    reader.releaseLock();
  }
}

/** Ejecuta un comando y devuelve toda su salida (stdout + stderr). */
export async function captureOutput(argv, options = {}) {
  const proc = Bun.spawn(argv, {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: options.cwd,
  });
  let output = '';
  await Promise.all([
    readStream(proc.stdout, (chunk) => { output += chunk; }),
    readStream(proc.stderr, (chunk) => { output += chunk; }),
  ]);
  const code = await proc.exited;
  return { output, code, signalCode: proc.signalCode };
}
