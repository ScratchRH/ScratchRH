import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogoMark } from "../components/LogoMark";

// How long the sting gets to play before we transition into the app —
// long enough to hear the hit land, short enough not to feel like a wait.
const TRANSITION_DELAY_MS = 1200;

export function Splash() {
  const [videoFailed, setVideoFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const navigate = useNavigate();

  function handlePlay() {
    // Browsers block audio autoplay entirely until a real user gesture —
    // this click is that gesture, so kick off the sting here rather than
    // relying on the video's (muted, autoplaying) audio track.
    audioRef.current?.play().catch(() => {});
    window.setTimeout(() => navigate("/home"), TRANSITION_DELAY_MS);
  }

  return (
    <div className="splash">
      {!videoFailed && (
        <video
          className="splash-video"
          src="/backgrounds/splash.mp4"
          autoPlay
          loop
          muted
          playsInline
          onError={() => setVideoFailed(true)}
        />
      )}
      <audio ref={audioRef} src="/audio/splash.mp3" preload="auto" />
      <div className="splash-scrim" />
      <div className="splash-content">
        <div className="splash-logo">
          <LogoMark size={48} />
          SCRATCH
        </div>
        <p className="splash-tagline">Every card pays real stock.</p>
        <button className="splash-play-btn" onClick={handlePlay}>
          Play
        </button>
      </div>
    </div>
  );
}
