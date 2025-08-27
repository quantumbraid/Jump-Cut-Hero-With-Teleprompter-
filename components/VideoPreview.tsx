import React, { useRef } from 'react';
import { RecordingState } from '../types';

interface VideoPreviewProps {
    stream: MediaStream | null;
    videoUrl: string | null;
    recordingState: RecordingState;
    isMirrored: boolean;
    orientation: 'landscape' | 'portrait';
    currentScriptLine?: string;
    onScriptScroll?: (direction: 'up' | 'down') => void;
}

const VideoPreview: React.FC<VideoPreviewProps> = ({ stream, videoUrl, recordingState, isMirrored, orientation, currentScriptLine, onScriptScroll }) => {
    const videoRef = React.useRef<HTMLVideoElement>(null);
    const lastScrollTime = useRef(0);
    const touchStartY = useRef<number | null>(null);

    const SCROLL_DEBOUNCE_MS = 200; // Prevent scrolling too fast
    const TOUCH_SCROLL_THRESHOLD = 30; // Min pixels to swipe

    React.useEffect(() => {
        const videoElement = videoRef.current;
        if (!videoElement) return;

        if (videoUrl) {
            // Switch to playback mode
            videoElement.srcObject = null;
            videoElement.src = videoUrl;
            videoElement.muted = false;
            videoElement.controls = true;
            videoElement.classList.remove('scale-x-[-1]'); // Always un-mirror for playback
            videoElement.load(); // Explicitly load the new source
        } else if (stream) {
            // Switch to live preview mode
            videoElement.src = '';
            videoElement.srcObject = stream;
            videoElement.muted = true;
            videoElement.controls = false;
            // Apply mirroring based on prop
            if (isMirrored) {
                videoElement.classList.add('scale-x-[-1]');
            } else {
                videoElement.classList.remove('scale-x-[-1]');
            }
            videoElement.play().catch(error => {
                console.log("Stream preview failed to play.", error);
            });
        } else {
             // Clean up if no source
             videoElement.srcObject = null;
             videoElement.src = '';
             videoElement.controls = false;
        }
    }, [stream, videoUrl, isMirrored]);

    const aspectClass = orientation === 'landscape' ? 'aspect-video' : 'aspect-[9/16]';
    const baseClasses = 'w-full rounded-lg shadow-2xl bg-black transition-all duration-300 relative';
    const isRecordingActive = recordingState === RecordingState.RECORDING || recordingState === RecordingState.PAUSED;
    const borderClass = isRecordingActive ? 'ring-4 ring-red-500 ring-offset-4 ring-offset-gray-900' : 'ring-2 ring-gray-700';
    
    // Using object-contain to ensure the full video is visible.
    const videoClasses = "w-full h-full object-contain rounded-lg";

    const shouldShowTeleprompter = isRecordingActive && currentScriptLine;

    const handleWheel = (e: React.WheelEvent) => {
        if (!onScriptScroll) return;
        const now = Date.now();
        if (now - lastScrollTime.current < SCROLL_DEBOUNCE_MS) return;
        
        lastScrollTime.current = now;
        if (e.deltaY > 0) {
            onScriptScroll('down');
        } else {
            onScriptScroll('up');
        }
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (touchStartY.current === null || !onScriptScroll) return;

        const currentY = e.touches[0].clientY;
        const deltaY = currentY - touchStartY.current;

        if (Math.abs(deltaY) > TOUCH_SCROLL_THRESHOLD) {
             // Swipe up (negative deltaY) advances to the next line
            if (deltaY < 0) {
                onScriptScroll('down');
            } else { // Swipe down (positive deltaY) goes to the previous line
                onScriptScroll('up');
            }
            // Reset to prevent multiple triggers for one long swipe
            touchStartY.current = null; 
        }
    };

    const handleTouchEnd = () => {
        touchStartY.current = null;
    };

    return (
        <div className={`${aspectClass} ${baseClasses} ${borderClass}`}>
            <video
                ref={videoRef}
                playsInline
                className={videoClasses}
            />
            {shouldShowTeleprompter && (
                <>
                    <div 
                        className="absolute inset-0 z-10 cursor-ns-resize"
                        onWheel={handleWheel}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                        aria-label="Scroll teleprompter"
                        role="scrollbar"
                    ></div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-4 rounded-b-lg pointer-events-none z-20">
                        <p key={currentScriptLine} className="text-center text-xl md:text-2xl font-semibold text-white drop-shadow-md">
                            {currentScriptLine}
                        </p>
                    </div>
                </>
            )}
        </div>
    );
};

export default VideoPreview;