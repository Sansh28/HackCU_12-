type VoicePlaybackPanelProps = {
  isPaused: boolean;
  pauseVoice: () => void;
  resumeVoice: () => void;
  stopVoice: () => void;
  waveHeights: number[];
};

export function VoicePlaybackPanel({ isPaused, pauseVoice, resumeVoice, stopVoice, waveHeights }: VoicePlaybackPanelProps) {
  return (
    <div className="border border-[#2f6554] rounded-xl bg-[#09141a]/65 backdrop-blur-sm p-3">
      <div className="h-10 flex items-center justify-center gap-1 my-1">
        {waveHeights.map((height, i) => (
          <div
            key={i}
            className="w-1.5 bg-[#f2c14e] rounded-full"
            style={{
              height: `${height}%`,
              opacity: isPaused ? 0.35 : 0.95,
              transition: "height 120ms linear, opacity 160ms ease",
            }}
          />
        ))}
        <div className="text-[#f2c14e] text-xs ml-4 font-mono uppercase tracking-widest">
          {isPaused ? "Voice Paused" : "Savant Speaking"}
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 mt-2">
        {!isPaused ? (
          <button
            type="button"
            onClick={pauseVoice}
            className="text-xs font-mono px-3 py-1.5 rounded border border-amber-500/50 text-amber-200 hover:bg-amber-500/10"
          >
            Pause
          </button>
        ) : (
          <button
            type="button"
            onClick={resumeVoice}
            className="text-xs font-mono px-3 py-1.5 rounded border border-[#b58a2c]/50 text-[#f2d18b] hover:bg-[#f2c14e]/10"
          >
            Resume
          </button>
        )}
        <button
          type="button"
          onClick={stopVoice}
          className="text-xs font-mono px-3 py-1.5 rounded border border-red-500/50 text-red-200 hover:bg-red-500/10"
        >
          Stop
        </button>
      </div>
    </div>
  );
}
