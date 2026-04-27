import startUrl from "../../assets/recording-start.mp3?url";
import stopUrl from "../../assets/recording-stop.mp3?url";

const startAudio = new Audio(startUrl);
const stopAudio = new Audio(stopUrl);
startAudio.preload = "auto";
stopAudio.preload = "auto";

function play(a: HTMLAudioElement): void {
  try {
    a.currentTime = 0;
    void a.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

export const playStartCue = () => play(startAudio);
export const playStopCue = () => play(stopAudio);
