import React, { useRef, useEffect } from 'react';
import { RecordingState } from '../types';

interface VideoPreviewProps {
    stream: MediaStream | null;
    videoUrl: string | null;
    recordingState: RecordingState;
    isMirrored: boolean;
    orientation: 'landscape' | 'portrait';
    currentScriptLine?: string;
    onScriptScroll?: (direction: 'up' | 'down') => void;
    onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
}

const VideoPreview: React.FC<VideoPreviewProps> = ({ stream, videoUrl, recordingState, isMirrored, orientation, currentScriptLine, onScriptScroll, onCanvasReady }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const lastScrollTime = useRef(0);
    const touchStartY = useRef<number | null>(null);

    const SCROLL_DEBOUNCE_MS = 200; // Prevent scrolling too fast
    const TOUCH_SCROLL_THRESHOLD = 30; // Min pixels to swipe

    useEffect(() => {
        const videoElement = videoRef.current;
        if (!videoElement) return;

        if (videoUrl) {
            // Setup for playback
            videoElement.srcObject = null;
            videoElement.src = videoUrl;
            videoElement.muted = false;
            videoElement.controls = true;
            videoElement.load();
        } else {
            // Cleanup for live view
            videoElement.src = '';
            videoElement.controls = false;
        }
    }, [videoUrl]);

    useEffect(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (videoUrl || !stream || !video || !canvas) {
            if (onCanvasReady) {
                onCanvasReady(null);
            }
            return;
        }

        if (onCanvasReady) {
            onCanvasReady(canvas);
        }

        video.srcObject = stream;
        video.muted = true;
        video.play().catch(error => {
            console.log("Stream preview failed to play.", error);
        });

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;

        const drawFrame = () => {
            if (!videoRef.current || video.paused || video.ended || video.readyState < video.HAVE_METADATA) {
                animationFrameId = requestAnimationFrame(drawFrame);
                return;
            }

            const videoWidth = video.videoWidth;
            const videoHeight = video.videoHeight;
            
            if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
                canvas.width = canvas.clientWidth;
                canvas.height = canvas.clientHeight;
            }
            
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;

            const videoAspect = videoWidth / videoHeight;
            const canvasAspect = canvasWidth / canvasHeight;

            let sx = 0, sy = 0, sWidth = videoWidth, sHeight = videoHeight;

            if (videoAspect > canvasAspect) {
                sWidth = videoHeight * canvasAspect;
                sx = (videoWidth - sWidth) / 2;
            } else {
                sHeight = videoWidth / canvasAspect;
                sy = (videoHeight - sHeight) / 2;
            }
            
            ctx.save();
            ctx.clearRect(0, 0, canvasWidth, canvasHeight);

            if (isMirrored) {
                ctx.scale(-1, 1);
                ctx.translate(-canvasWidth, 0);
            }

            ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, canvasWidth, canvasHeight);
            ctx.restore();

            animationFrameId = requestAnimationFrame(drawFrame);
        };

        drawFrame();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [stream, videoUrl, isMirrored, onCanvasReady]);

    const aspectClass = orientation === 'landscape' ? 'aspect-video' : 'aspect-[9/16]';
    const baseClasses = 'w-full rounded-lg shadow-2xl bg-black transition-all duration-300 relative overflow-hidden';
    const isRecordingActive = recordingState === RecordingState.RECORDING || recordingState === RecordingState.PAUSED;
    const borderClass = isRecordingActive ? 'ring-4 ring-red-500 ring-offset-4 ring-offset-gray-900' : 'ring-2 ring-gray-700';
    
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
             if (deltaY < 0) {
                onScriptScroll('down');
            } else {
                onScriptScroll('up');
            }
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
                className={videoUrl ? "w-full h-full object-contain rounded-lg" : "hidden"}
            />
            {!videoUrl && <canvas ref={canvasRef} className="w-full h-full" />}
            
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
