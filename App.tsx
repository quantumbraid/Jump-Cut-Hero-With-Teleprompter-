import React, { useState, useRef, useCallback, useEffect } from 'react';
import { RecordingState } from './types';
import { CALIBRATION_TIME_MS, BASE_SILENCE_DETECTION_TIME_MS, PAUSE_TIGHTNESS_STEP_MS, SILENCE_MULTIPLIER, SOUND_MULTIPLIER, FFT_SIZE } from './constants';
import VideoPreview from './components/VideoPreview';
import StatusIndicator from './components/StatusIndicator';
import { Icon } from './components/Icon';

const App = () => {
    const [recordingState, setRecordingState] = useState<RecordingState>(RecordingState.IDLE);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [calibrationCountdown, setCalibrationCountdown] = useState<number>(CALIBRATION_TIME_MS);

    // Settings state
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
    const [isMirrored, setIsMirrored] = useState<boolean>(true);
    const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
    const [hasPermissions, setHasPermissions] = useState(false);
    const [pauseTightness, setPauseTightness] = useState<number>(0);
    
    // Teleprompter and Pause state
    const [script, setScript] = useState<string>('');
    const [scriptLines, setScriptLines] = useState<string[]>([]);
    const [currentLineIndex, setCurrentLineIndex] = useState<number>(0);
    const [isManuallyPaused, setIsManuallyPaused] = useState<boolean>(false);

    // Live stream state for preview
    const [liveStream, setLiveStream] = useState<MediaStream | null>(null);

    const streamRef = useRef<MediaStream | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const silenceThresholdRef = useRef<number>(0);
    const animationFrameRef = useRef<number>(0);
    
    const getDevices = useCallback(async () => {
        try {
            // First, request permissions to get device labels and ensure access.
            await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            setHasPermissions(true);
            const allDevices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = allDevices.filter(device => device.kind === 'videoinput');
            setDevices(videoDevices);
        } catch (err: any) {
            setError('Could not access camera/microphone. Please check permissions in your browser settings.');
            console.error("Permission or device error:", err);
            setHasPermissions(false);
        }
    }, []);

    useEffect(() => {
        getDevices();
        navigator.mediaDevices.addEventListener('devicechange', getDevices);
        return () => {
            navigator.mediaDevices.removeEventListener('devicechange', getDevices);
        };
    }, [getDevices]);

    useEffect(() => {
        if (devices.length > 0 && !selectedDeviceId) {
            setSelectedDeviceId(devices[0].deviceId);
        }
    }, [devices, selectedDeviceId]);

    const stopPreviewStream = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
            setLiveStream(null);
        }
    }, []);
    
    const cleanupRecording = useCallback(() => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        mediaRecorderRef.current = null;
        recordedChunksRef.current = [];
    }, []);

    const startPreview = useCallback(async () => {
        if (streamRef.current) {
            stopPreviewStream();
        }

        if (!selectedDeviceId) return;

        const videoConstraints: MediaTrackConstraints = {
            deviceId: { exact: selectedDeviceId },
        };
        if (orientation === 'landscape') {
            videoConstraints.width = { ideal: 1280 };
            videoConstraints.height = { ideal: 720 };
        } else {
            videoConstraints.width = { ideal: 720 };
            videoConstraints.height = { ideal: 1280 };
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true });
            streamRef.current = stream;
            setLiveStream(stream);
            setError(null);
        } catch (err: any) {
            if (err.name === 'OverconstrainedError') {
                setError(`The selected camera does not support ${orientation} orientation. Please try another setting or camera.`);
            } else {
                setError('Could not access camera/microphone. Please check permissions.');
            }
            setLiveStream(null);
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
        }
    }, [selectedDeviceId, orientation, stopPreviewStream]);

    useEffect(() => {
        if (recordingState === RecordingState.IDLE && hasPermissions) {
            startPreview();
        }
    }, [selectedDeviceId, orientation, recordingState, hasPermissions, startPreview]);

    useEffect(() => {
        return () => {
            cleanupRecording();
            stopPreviewStream();
        };
    }, [cleanupRecording, stopPreviewStream]);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && recordingState !== RecordingState.IDLE && recordingState !== RecordingState.STOPPED) {
            mediaRecorderRef.current.stop();
            setRecordingState(RecordingState.STOPPED);
        }
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        cancelAnimationFrame(animationFrameRef.current);
        setIsManuallyPaused(false);
    }, [recordingState]);

    const runAudioAnalysis = useCallback(() => {
        if (!analyserRef.current || recordingState === RecordingState.CALIBRATING) {
            animationFrameRef.current = requestAnimationFrame(runAudioAnalysis);
            return;
        };

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        
        const averageVolume = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
        
        const isSilent = averageVolume < silenceThresholdRef.current * SILENCE_MULTIPLIER;
        const isLoudEnoughToResume = averageVolume > silenceThresholdRef.current * SOUND_MULTIPLIER;

        // A positive tightness value should DECREASE the pause time (tighter cuts).
        const silenceDetectionTime = BASE_SILENCE_DETECTION_TIME_MS - (pauseTightness * PAUSE_TIGHTNESS_STEP_MS);

        if (mediaRecorderRef.current) {
            if (mediaRecorderRef.current.state === 'recording' && isSilent) {
                if (!silenceTimerRef.current) {
                    silenceTimerRef.current = setTimeout(() => {
                        if (mediaRecorderRef.current?.state === 'recording') {
                             setIsManuallyPaused(false);
                             mediaRecorderRef.current.pause();
                             setRecordingState(RecordingState.PAUSED);
                        }
                    }, silenceDetectionTime);
                }
            } else if (mediaRecorderRef.current.state === 'recording' && !isSilent) {
                 if (silenceTimerRef.current) {
                    clearTimeout(silenceTimerRef.current);
                    silenceTimerRef.current = null;
                }
            } else if (mediaRecorderRef.current.state === 'paused' && isLoudEnoughToResume && !isManuallyPaused) {
                mediaRecorderRef.current.resume();
                setRecordingState(RecordingState.RECORDING);
            }
        }
        
        animationFrameRef.current = requestAnimationFrame(runAudioAnalysis);
    }, [recordingState, isManuallyPaused, pauseTightness]);

    const startActualRecording = useCallback(() => {
        if (!streamRef.current) return;
        setRecordingState(RecordingState.RECORDING);

        const options = { mimeType: 'video/webm; codecs=vp9' };
        mediaRecorderRef.current = new MediaRecorder(streamRef.current, options);

        mediaRecorderRef.current.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunksRef.current.push(event.data);
            }
        };

        mediaRecorderRef.current.onstop = () => {
            const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            setVideoUrl(url);
            cleanupRecording();
            stopPreviewStream();
        };
        
        mediaRecorderRef.current.start(1000); 
        runAudioAnalysis();

    }, [cleanupRecording, runAudioAnalysis, stopPreviewStream]);

    const startCalibration = useCallback(async () => {
        setRecordingState(RecordingState.CALIBRATING);
        setError(null);
        setVideoUrl(null);
        recordedChunksRef.current = [];
        setIsManuallyPaused(false);
        
        const lines = script.trim().split('\n').filter(line => line.trim().length > 0);
        setScriptLines(lines);
        setCurrentLineIndex(0);

        try {
            if (!streamRef.current) {
                setError("Camera stream is not available. Please check permissions and camera selection.");
                setRecordingState(RecordingState.IDLE);
                return;
            }

            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = FFT_SIZE;
            source.connect(analyserRef.current);

            const calibrationData: number[] = [];
            setCalibrationCountdown(CALIBRATION_TIME_MS);
            const countdownInterval = setInterval(() => {
                setCalibrationCountdown(prev => prev - 100);
            }, 100);

            const collectCalibrationData = () => {
                if (audioContextRef.current && analyserRef.current && audioContextRef.current.state === 'running') {
                    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
                    analyserRef.current.getByteFrequencyData(dataArray);
                    const averageVolume = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
                    calibrationData.push(averageVolume);
                }
            };
            
            const collectionInterval = setInterval(collectCalibrationData, 50);

            setTimeout(() => {
                clearInterval(collectionInterval);
                clearInterval(countdownInterval);
                if (calibrationData.length > 0) {
                    const average = calibrationData.reduce((a, b) => a + b, 0) / calibrationData.length;
                    silenceThresholdRef.current = average > 0 ? average : 1;
                } else {
                    silenceThresholdRef.current = 1;
                }

                startActualRecording();

            }, CALIBRATION_TIME_MS);
        } catch (err: any) {
            setError('Could not start recording process. Please try again.');
            setRecordingState(RecordingState.IDLE);
            cleanupRecording();
        }
    }, [cleanupRecording, startActualRecording, script]);
    
    const handleReset = () => {
        setRecordingState(RecordingState.IDLE);
        setVideoUrl(null);
        setError(null);
        setScriptLines([]);
        setCurrentLineIndex(0);
        setIsManuallyPaused(false);
        cleanupRecording();
    };
    
    const handleManualPause = () => {
        if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.pause();
            setRecordingState(RecordingState.PAUSED);
            setIsManuallyPaused(true);
        }
    };
    
    const handleResume = () => {
        if (mediaRecorderRef.current?.state === 'paused') {
            setIsManuallyPaused(false);
            mediaRecorderRef.current.resume();
            setRecordingState(RecordingState.RECORDING);
        }
    };

    const handleScriptScroll = useCallback((direction: 'up' | 'down') => {
        if (scriptLines.length === 0) return;
    
        setCurrentLineIndex(prev => {
            if (direction === 'down') {
                return Math.min(prev + 1, scriptLines.length - 1);
            } else {
                return Math.max(prev - 1, 0);
            }
        });
    }, [scriptLines.length]);

    const handleTightnessChange = (delta: number) => {
        setPauseTightness(prev => Math.max(-5, Math.min(5, prev + delta)));
    };

    const renderControls = () => {
        switch(recordingState){
            case RecordingState.IDLE:
                return <button onClick={startCalibration} className="bg-red-600 hover:bg-red-700 text-white font-bold py-4 px-8 rounded-full flex items-center space-x-3 text-lg transition-transform transform hover:scale-105 shadow-lg"><Icon icon="record" className="w-6 h-6" /><span>Start Recording</span></button>;
            case RecordingState.CALIBRATING:
                return <button disabled className="bg-yellow-500 text-white font-bold py-4 px-8 rounded-full flex items-center space-x-3 text-lg cursor-not-allowed"><div className="w-6 h-6 border-t-2 border-white rounded-full animate-spin"></div><span>Calibrating...</span></button>;
            case RecordingState.RECORDING:
                return (
                    <div className="flex space-x-4">
                        <button onClick={handleManualPause} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-full flex items-center space-x-3 text-lg transition-transform transform hover:scale-105 shadow-lg"><Icon icon="pause" className="w-6 h-6" /><span>Pause</span></button>
                        <button onClick={stopRecording} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-4 px-8 rounded-full flex items-center space-x-3 text-lg transition-transform transform hover:scale-105 shadow-lg"><Icon icon="stop" className="w-6 h-6" /><span>Stop</span></button>
                    </div>
                );
            case RecordingState.PAUSED:
                return (
                    <div className="flex space-x-4">
                        <button onClick={handleResume} className="bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-8 rounded-full flex items-center space-x-3 text-lg transition-transform transform hover:scale-105 shadow-lg"><Icon icon="play" className="w-6 h-6" /><span>Resume</span></button>
                        <button onClick={stopRecording} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-4 px-8 rounded-full flex items-center space-x-3 text-lg transition-transform transform hover:scale-105 shadow-lg"><Icon icon="stop" className="w-6 h-6" /><span>Stop</span></button>
                    </div>
                );
            case RecordingState.STOPPED:
                return (
                    <div className="flex space-x-4">
                        <a href={videoUrl!} download="jump-cut-hero-video.webm" className="bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-8 rounded-full flex items-center space-x-3 text-lg transition-transform transform hover:scale-105 shadow-lg"><Icon icon="download" className="w-6 h-6"/><span>Download Video</span></a>
                        <button onClick={handleReset} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-4 px-8 rounded-full flex items-center space-x-3 text-lg transition-transform transform hover:scale-105 shadow-lg"><span>Record Again</span></button>
                    </div>
                );
        }
    }

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 font-sans">
            <header className="text-center mb-6">
                <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-red-500 to-yellow-400">Jump Cut Hero</span>
                </h1>
                <p className="mt-2 text-lg text-gray-400 max-w-2xl mx-auto">Record videos without silent gaps. No editing required.</p>
            </header>

            <main className="w-full max-w-4xl flex flex-col items-center gap-6">
                {recordingState === RecordingState.IDLE && (
                    <>
                        <div className="w-full p-4 bg-gray-800/50 rounded-lg shadow-md border border-gray-700">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div className="flex flex-col">
                                    <label htmlFor="camera-select" className="text-sm font-medium text-gray-400 mb-2">Camera</label>
                                    <select
                                        id="camera-select"
                                        value={selectedDeviceId}
                                        onChange={(e) => setSelectedDeviceId(e.target.value)}
                                        disabled={devices.length === 0}
                                        className="bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-red-500 focus:border-red-500 block w-full p-2.5"
                                    >
                                        {devices.length === 0 && <option>No cameras found</option>}
                                        {devices.map((device, index) => (
                                            <option key={device.deviceId} value={device.deviceId}>
                                                {device.label || `Camera ${index + 1}`}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-sm font-medium text-gray-400 mb-2">Orientation</label>
                                    <div className="flex w-full bg-gray-700 rounded-lg p-1">
                                        <button onClick={() => setOrientation('landscape')} className={`flex-1 px-3 py-1.5 text-sm font-semibold rounded-md transition ${orientation === 'landscape' ? 'bg-red-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}>Landscape</button>
                                        <button onClick={() => setOrientation('portrait')} className={`flex-1 px-3 py-1.5 text-sm font-semibold rounded-md transition ${orientation === 'portrait' ? 'bg-red-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}>Portrait</button>
                                    </div>
                                </div>
                                 <div className="flex flex-col">
                                    <label htmlFor="pause-tightness" className="text-sm font-medium text-gray-400 mb-2">Pause Tightness</label>
                                    <div className="flex items-center justify-center bg-gray-700 rounded-lg p-1 w-full">
                                        <button onClick={() => handleTightnessChange(-1)} disabled={pauseTightness === -5} className="px-4 py-1.5 text-lg font-bold rounded-md transition text-gray-300 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Decrease pause tightness">
                                            <Icon icon="minus" className="w-5 h-5" />
                                        </button>
                                        <span className="flex-1 text-center text-base font-semibold tabular-nums">{pauseTightness > 0 ? `+${pauseTightness}` : pauseTightness}</span>
                                        <button onClick={() => handleTightnessChange(1)} disabled={pauseTightness === 5} className="px-4 py-1.5 text-lg font-bold rounded-md transition text-gray-300 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Increase pause tightness">
                                            <Icon icon="plus" className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                                <div className="flex items-center justify-center h-full">
                                    <label htmlFor="mirror-toggle" className="flex items-center cursor-pointer">
                                        <span className="mr-3 text-sm font-medium text-gray-300">Mirror Preview</span>
                                        <div className="relative">
                                            <input type="checkbox" id="mirror-toggle" className="sr-only peer" checked={isMirrored} onChange={() => setIsMirrored(!isMirrored)} />
                                            <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
                                        </div>
                                    </label>
                                </div>
                            </div>
                        </div>

                        <div className="w-full h-48 bg-gray-800/50 rounded-lg shadow-md border border-gray-700 p-4 flex flex-col transition-all duration-300">
                            <label htmlFor="script-input" className="text-sm font-medium text-gray-400 mb-2">
                                Teleprompter Script (Optional)
                            </label>
                            <textarea
                                id="script-input"
                                value={script}
                                onChange={(e) => setScript(e.target.value)}
                                className="flex-grow bg-gray-900/50 border border-gray-600 text-white text-base rounded-lg focus:ring-red-500 focus:border-red-500 block w-full p-2.5 resize-none placeholder:text-gray-500"
                                placeholder="Paste your script here. Each new line is a new prompt. The recording stops automatically after the last line."
                                aria-label="Teleprompter Script Input"
                            />
                            <p className="text-xs text-gray-500 mt-2">
                                Tip: Use new lines (Enter key) to separate sentences. You can scroll the prompter during recording.
                            </p>
                        </div>
                    </>
                )}
                
                <div className="w-full relative">
                     <StatusIndicator state={recordingState} calibrationCountdown={calibrationCountdown} />
                      {(!liveStream && !videoUrl && recordingState === RecordingState.IDLE) ? (
                        <div className={`${orientation === 'landscape' ? 'aspect-video' : 'aspect-[9/16]'} w-full rounded-lg bg-black flex items-center justify-center shadow-2xl ring-2 ring-gray-700`}>
                            <p className="text-gray-500 px-4 text-center">
                                {hasPermissions ? 'Select a camera to start preview' : 'Awaiting camera & microphone permissions...'}
                            </p>
                        </div>
                    ) : (
                        <VideoPreview 
                            stream={liveStream} 
                            videoUrl={videoUrl} 
                            recordingState={recordingState}
                            isMirrored={isMirrored}
                            orientation={orientation}
                            currentScriptLine={scriptLines[currentLineIndex]}
                            onScriptScroll={handleScriptScroll}
                        />
                    )}
                </div>
                {error && <p className="text-red-500">{error}</p>}
                <div className="h-20 flex items-center justify-center">
                   {renderControls()}
                </div>
            </main>
            
            <footer className="text-center text-gray-500 mt-8 text-sm">
                <p>&copy; {new Date().getFullYear()} Jump Cut Hero. The smart way to record.</p>
            </footer>
        </div>
    );
};

export default App;