/**
 * Browser-native audio playback and speech recognition utilities.
 * Enhanced with immediate hard-stop, latency measurement, and generation association.
 */

import type { AudioStopResult } from "@/types/interrupt";

// Global reference for active audio playback
let currentActiveAudio: HTMLAudioElement | null = null;
let activeAudioGenerationId: number | null = null;
let currentObjectUrl: string | null = null;

// Simulated playback handle for headless test environments
let simulatedPlaybackTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Plays a binary Audio Blob using browser native Audio.
 * Uses URL.createObjectURL and explicitly revokes it when finished, errored, or interrupted.
 * Associates playback with a specific generation ID.
 */
export function playAudioBlob(
  blob: Blob,
  generationId?: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // Hard stop any ongoing playback first
      stopActiveAudio();

      activeAudioGenerationId = typeof generationId === "number" ? generationId : null;

      if (typeof window === "undefined" || typeof URL === "undefined" || typeof Audio === "undefined") {
        resolve();
        return;
      }

      const url = URL.createObjectURL(blob);
      currentObjectUrl = url;

      const audio = new Audio();
      audio.src = url;
      currentActiveAudio = audio;

      const cleanup = () => {
        if (currentObjectUrl) {
          try {
            URL.revokeObjectURL(currentObjectUrl);
          } catch {
            // Ignored
          }
          currentObjectUrl = null;
        }
        if (currentActiveAudio === audio) {
          currentActiveAudio = null;
          activeAudioGenerationId = null;
        }
      };

      audio.onended = () => {
        cleanup();
        resolve();
      };

      audio.onerror = (err) => {
        const code = audio.error?.code;
        const msg = audio.error?.message;
        cleanup();
        console.warn(`[browser-audio] Audio element playback error (code=${code}, msg=${msg}):`, err);
        reject(new Error(`Audio playback failed (code=${code}, msg=${msg})`));
      };

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log(
              `[browser-audio] Playback started successfully: MIME=${blob.type}, size=${blob.size} bytes, genId=${generationId}`
            );
          })
          .catch((err) => {
            cleanup();
            console.warn("[browser-audio] Audio play() promise rejected:", err);
            resolve(); // Resolve rather than throwing unhandled rejection (e.g. autoplay policy)
          });
      }
    } catch (err) {
      if (currentObjectUrl) {
        try {
          URL.revokeObjectURL(currentObjectUrl);
        } catch {
          // Ignored
        }
        currentObjectUrl = null;
      }
      currentActiveAudio = null;
      activeAudioGenerationId = null;
      console.warn("[browser-audio] Unable to initialize audio element:", err);
      resolve();
    }
  });
}

/**
 * Plays raw ArrayBuffer audio data by wrapping it into a typed Blob and Object URL.
 */
export function playAudioBuffer(
  buffer: ArrayBuffer,
  contentType = "audio/mpeg",
  generationId?: number
): Promise<void> {
  const blob = new Blob([buffer], { type: contentType });
  return playAudioBlob(blob, generationId);
}

/**
 * Plays base64 audio data using browser native Audio backed by Blob and Object URL.
 * Eliminates data-URI length limits and mime-type rejection.
 * Associates playback with a specific generation ID.
 * Resolves when playback completes normally, rejects if interrupted or errored.
 */
export function playBase64Audio(
  base64Audio: string,
  contentType = "audio/mpeg",
  generationId?: number
): Promise<void> {
  try {
    const binaryString =
      typeof atob !== "undefined"
        ? atob(base64Audio)
        : Buffer.from(base64Audio, "base64").toString("binary");
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: contentType });
    return playAudioBlob(blob, generationId);
  } catch (err) {
    console.warn("[browser-audio] Failed to decode base64 audio:", err);
    return Promise.resolve();
  }
}

/**
 * Stops any actively playing browser audio immediately.
 * Pauses audio, resets position, removes event handlers, revokes Object URLs, and measures stop latency.
 */
export function stopActiveAudio(): AudioStopResult {
  const startTimestamp = typeof performance !== "undefined" ? performance.now() : Date.now();
  let stopped = false;
  let playbackPositionSeconds = 0;

  // Revoke active Object URL to prevent memory leaks
  if (currentObjectUrl) {
    try {
      URL.revokeObjectURL(currentObjectUrl);
    } catch {
      // Ignored
    }
    currentObjectUrl = null;
  }

  // Stop simulated audio if active
  if (simulatedPlaybackTimer) {
    clearTimeout(simulatedPlaybackTimer);
    simulatedPlaybackTimer = null;
    stopped = true;
  }

  // Stop HTML5 Audio if active
  if (currentActiveAudio) {
    try {
      playbackPositionSeconds = currentActiveAudio.currentTime;
      // Remove event handlers to prevent late onended/onerror callbacks
      currentActiveAudio.onended = null;
      currentActiveAudio.onerror = null;

      currentActiveAudio.pause();
      currentActiveAudio.currentTime = 0;
      currentActiveAudio.src = "";
      stopped = true;
    } catch (err) {
      console.warn("[browser-audio] Error while stopping audio element:", err);
    } finally {
      currentActiveAudio = null;
      activeAudioGenerationId = null;
    }
  }

  const endTimestamp = typeof performance !== "undefined" ? performance.now() : Date.now();
  const rawLatency = Math.round(endTimestamp - startTimestamp);
  const stopLatencyMs = Math.max(1, rawLatency);

  return {
    stopped,
    stopLatencyMs: stopped ? stopLatencyMs : 0,
    timestamp: Date.now(),
    playbackPositionSeconds,
  };
}

/**
 * Returns the generation ID currently being played, if any.
 */
export function getActiveAudioGeneration(): number | null {
  return activeAudioGenerationId;
}

/**
 * Deterministic audio simulation helper for automated testing and fallback environments.
 * Simulates active playback that can be immediately interrupted by stopActiveAudio().
 */
export function simulateAudioPlayback(
  durationMs: number,
  generationId?: number
): Promise<boolean> {
  return new Promise((resolve) => {
    stopActiveAudio();
    activeAudioGenerationId = typeof generationId === "number" ? generationId : null;

    simulatedPlaybackTimer = setTimeout(() => {
      simulatedPlaybackTimer = null;
      activeAudioGenerationId = null;
      resolve(true); // Completed normally
    }, durationMs);
  });
}

/**
 * Checks whether native Web Speech API is supported in the current browser.
 */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const win = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
}

export type SpeechRecognitionCallbacks = {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (errorMsg: string) => void;
  onEnd: () => void;
};

/**
 * Starts a browser speech recognition session if supported.
 * Returns a cleanup function that aborts recognition.
 */
export function startNativeSpeechRecognition(
  callbacks: SpeechRecognitionCallbacks
): () => void {
  if (!isSpeechRecognitionSupported()) {
    callbacks.onError("Speech recognition not supported in this browser.");
    callbacks.onEnd();
    return () => {};
  }

  const win = window as unknown as {
    SpeechRecognition?: new () => any;
    webkitSpeechRecognition?: new () => any;
  };

  const SpeechRecognitionClass =
    win.SpeechRecognition || win.webkitSpeechRecognition;

  if (!SpeechRecognitionClass) {
    callbacks.onError("SpeechRecognition unavailable");
    callbacks.onEnd();
    return () => {};
  }

  try {
    const recognition = new SpeechRecognitionClass();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalTranscript = "";

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item?.[0]?.transcript) {
          if (item.isFinal) {
            finalTranscript += item[0].transcript;
          } else {
            interim += item[0].transcript;
          }
        }
      }

      const text = finalTranscript || interim;
      if (text.trim().length > 0) {
        callbacks.onTranscript(text.trim(), Boolean(finalTranscript));
      }
    };

    recognition.onerror = (event: any) => {
      const errorMsg = event.error || "Speech recognition error";
      if (errorMsg === "aborted") {
        return;
      }
      console.warn("[browser-speech] Recognition error:", errorMsg);
      callbacks.onError(errorMsg);
    };

    recognition.onend = () => {
      callbacks.onEnd();
    };

    recognition.start();

    return () => {
      try {
        recognition.abort();
      } catch {
        // Ignored
      }
    };
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : "Failed to start");
    callbacks.onEnd();
    return () => {};
  }
}
