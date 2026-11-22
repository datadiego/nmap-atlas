let sound: HTMLAudioElement | null = null;

/** Reproduce el aviso sonoro al terminar un escaneo. Nunca interrumpe la app si falla. */
export function playSuccessSound(): void {
  try {
    sound ??= new Audio('/success.mp3');
    sound.currentTime = 0;
    void sound.play().catch(() => {
      // El navegador puede bloquear el audio; el escaneo ya se ha cargado igualmente.
    });
  } catch {
    // Audio no disponible en este entorno.
  }
}
