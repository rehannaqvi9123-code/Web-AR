/**
 * CONTROLLER: qrController.js
 * ──────────────────────────────────────────────────────────────────────────────
 * Manages camera initialisation and the QR-code scanning loop.
 *
 * MIRROR FIX:
 *   The original code applied `transform: scaleX(-1)` unconditionally to the
 *   <video> element. With a rear (environment) camera this causes a mirrored
 *   display AND can confuse QR orientation.
 *
 *   Fix strategy:
 *   1. Request the rear camera (facingMode: 'environment') — never flip.
 *   2. If only a front camera is available, flip the <video> display via CSS
 *      but draw the canvas MIRRORED so jsQR still decodes correctly.
 *   3. The scan area is taken directly from the raw video feed (canvas) so
 *      decoding is always correct regardless of the display flip.
 * ──────────────────────────────────────────────────────────────────────────────
 */

const QRController = (() => {

    let _stream        = null;  // Active MediaStream
    let _scanning      = false; // Scan loop active flag
    let _isFrontCamera = false; // Track which camera is in use
    let _onQRDetected  = null;  // Callback: (qrData: string) => void

    // ── Camera ────────────────────────────────────────────────────────────────

    /**
     * Start the camera and begin the QR scan loop.
     * @param {function} onDetected - Called with the decoded QR string.
     * @param {function} [onError]  - Called with an error message string.
     */
    async function startCamera(onDetected, onError) {
        _onQRDetected = onDetected;

        try {
            // Stop any existing stream first
            stopCamera();

            // 1. Try rear (environment) camera — best for scanning
            try {
                _stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: { exact: 'environment' },
                        width:  { ideal: 1280 },
                        height: { ideal: 720 }
                    },
                    audio: false
                });
                _isFrontCamera = false;
            } catch {
                // 2. Fallback: any available camera (likely front camera on laptops)
                _stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: false
                });
                _isFrontCamera = true;
                console.warn('[QRController] Using front/default camera — display will be mirrored for UX.');
            }

            const video = document.getElementById('video');
            video.srcObject = _stream;

            // Apply CSS mirror ONLY when using front camera (cosmetic UX only)
            // The canvas scan loop compensates internally — see _scanFrame()
            video.style.transform = _isFrontCamera ? 'scaleX(-1)' : 'none';

            await new Promise(resolve => {
                video.onloadedmetadata = () => { video.play(); resolve(); };
            });

            // Show the camera UI, hide the loading screen
            document.getElementById('loading-screen').style.display  = 'none';
            document.getElementById('camera-container').style.display = 'block';

            // Begin scan loop
            _scanning = true;
            requestAnimationFrame(_scanFrame);

            console.log(`[QRController] Camera started (${_isFrontCamera ? 'front' : 'rear'})`);

        } catch (err) {
            console.error('[QRController] Camera error:', err.message);
            if (onError) onError(`Camera error: ${err.message}. Please allow camera access.`);
        }
    }

    /** Stop all camera tracks and the scan loop. */
    function stopCamera() {
        _scanning = false;
        if (_stream) {
            _stream.getTracks().forEach(t => t.stop());
            _stream = null;
        }
    }

    // ── Scan Loop ─────────────────────────────────────────────────────────────

    /**
     * Core animation-frame scan function.
     * Draws the current video frame to a hidden canvas, reads the central
     * scan zone, and passes it to jsQR for decoding.
     *
     * Front-camera mirror fix:
     *   When _isFrontCamera is true we flip the canvas context horizontally
     *   before drawing so that jsQR receives an un-mirrored image even though
     *   the <video> element itself is visually flipped via CSS.
     */
    function _scanFrame() {
        if (!_scanning) return;

        try {
            const video  = document.getElementById('video');
            const canvas = document.getElementById('canvas');
            const ctx    = canvas.getContext('2d');

            // Wait until video has real dimensions
            if (!video.readyState || video.readyState < 2) {
                requestAnimationFrame(_scanFrame);
                return;
            }

            canvas.width  = video.videoWidth;
            canvas.height = video.videoHeight;

            // For front camera: flip the canvas draw so jsQR gets a normal image
            if (_isFrontCamera) {
                ctx.save();
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                ctx.restore();
            } else {
                // Rear camera — draw normally (no flip needed)
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            }

            // Define the central scan zone (250 × 250 px)
            const scanSize = 250;
            const scanX    = Math.floor((canvas.width  - scanSize) / 2);
            const scanY    = Math.floor((canvas.height - scanSize) / 2);

            const imageData = ctx.getImageData(scanX, scanY, scanSize, scanSize);
            const code      = jsQR(imageData.data, scanSize, scanSize, {
                inversionAttempts: 'dontInvert'
            });

            if (code && _onQRDetected) {
                _onQRDetected(code.data);
            }

        } catch (err) {
            console.error('[QRController] Scan frame error:', err.message);
        }

        requestAnimationFrame(_scanFrame);
    }

    // ── Public API ────────────────────────────────────────────────────────────
    return { startCamera, stopCamera };

})();

window.QRController = QRController;
