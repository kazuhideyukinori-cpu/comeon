interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: { transcript: string };
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export class VoiceTranscriber {
  private recognition: SpeechRecognitionLike | null = null;
  private finalText = "";
  private onUpdate: (finalText: string, interimText: string) => void;
  private onStop: () => void;
  private onError: (message: string) => void;

  constructor(
    onUpdate: (finalText: string, interimText: string) => void,
    onStop: () => void,
    onError: (message: string) => void,
  ) {
    this.onUpdate = onUpdate;
    this.onStop = onStop;
    this.onError = onError;
  }

  start(seedText: string): void {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      this.onError("このブラウザは音声入力に対応していません（Chromeなどをお使いください）。テキストで直接入力できます。");
      return;
    }
    this.finalText = seedText;
    const recognition = new Ctor();
    recognition.lang = "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          this.finalText += text;
        } else {
          interim += text;
        }
      }
      this.onUpdate(this.finalText, interim);
    };
    recognition.onerror = (ev) => {
      this.onError(`音声認識エラー: ${ev.error ?? "不明なエラー"}`);
    };
    recognition.onend = () => {
      this.onStop();
    };
    this.recognition = recognition;
    recognition.start();
  }

  stop(): void {
    this.recognition?.stop();
    this.recognition = null;
  }
}
