export function getLocalSpeechVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  return window.speechSynthesis.getVoices().find((voice) => voice.localService) ?? null
}

export async function getLocalSpeechVoiceWhenReady(timeoutMs = 1_500): Promise<SpeechSynthesisVoice | null> {
  const immediate = getLocalSpeechVoice()
  if (immediate || typeof window === 'undefined' || !window.speechSynthesis) return immediate
  const synthesis = window.speechSynthesis
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const finish = (voice: SpeechSynthesisVoice | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      synthesis.removeEventListener('voiceschanged', onVoicesChanged)
      resolve(voice)
    }
    const onVoicesChanged = (): void => {
      const voice = getLocalSpeechVoice()
      if (voice) finish(voice)
    }
    synthesis.addEventListener('voiceschanged', onVoicesChanged)
    timer = setTimeout(() => finish(getLocalSpeechVoice()), Math.max(0, timeoutMs))
    onVoicesChanged()
  })
}

export function speakWithLocalVoice(text: string): boolean {
  const voice = getLocalSpeechVoice()
  if (!voice || !text) return false
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 4_000))
  utterance.voice = voice
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
  return true
}
