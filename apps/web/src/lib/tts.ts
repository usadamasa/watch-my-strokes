/**
 * Web Speech API の薄いラッパー。
 * コーチの発話は「最新を優先」— 新しいアドバイスが来たら読み上げ中のものは打ち切る。
 * speechSynthesis がない環境(ヘッドレス等)では何もしない。
 */
export class Speaker {
  readonly supported: boolean =
    typeof window !== "undefined" && "speechSynthesis" in window;

  speak(text: string, lang = "ja-JP"): void {
    if (!this.supported) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 1.05;
      window.speechSynthesis.speak(utterance);
    } catch {
      // 読み上げ失敗でセッションを止めない
    }
  }

  stop(): void {
    if (!this.supported) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // no-op
    }
  }
}
