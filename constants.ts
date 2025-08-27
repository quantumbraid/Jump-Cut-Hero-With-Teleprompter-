// How long the calibration period is in milliseconds.
export const CALIBRATION_TIME_MS = 3000;

// The base duration of silence that must be detected before pausing.
// This is the default "0" setting for Pause Tightness.
export const BASE_SILENCE_DETECTION_TIME_MS = 400;

// The amount of time (in ms) to add/remove from the base silence detection time for each step of "Pause Tightness".
export const PAUSE_TIGHTNESS_STEP_MS = 50;

// --- SILENCE DETECTION MULTIPLIER ---
// This multiplier is used to determine when to PAUSE the recording.
// Audio below (calibrated background noise * multiplier) is considered silence.
// A higher value makes the app more sensitive to silence, resulting in faster pauses.
export const SILENCE_MULTIPLIER = 2.0;

// --- SOUND DETECTION MULTIPLIER ---
// This multiplier is used to determine when to RESUME the recording.
// Audio must be ABOVE (calibrated background noise * multiplier) to be considered intentional sound.
// A higher value makes the app less sensitive, requiring a louder sound to resume.
export const SOUND_MULTIPLIER = 2.5;


// The size of the FFT (Fast Fourier Transform) for the audio analyser. Must be a power of 2.
export const FFT_SIZE = 256;