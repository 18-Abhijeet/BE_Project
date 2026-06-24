// frontend/src/hooks/useFaceRecognition.js
import { useRef, useState, useEffect } from "react";
import * as faceapi from "face-api.js";

// ── Global singleton — models are loaded ONCE for the entire session ──────────
let modelsPromise = null;

export default function useFaceRecognition() {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);

  const [modelReady, setModelReady] = useState(false);
  const [facing,     setFacing]     = useState(false);

  // Load ALL required models including TinyFaceDetector (fast real-time model)
  useEffect(() => {
    if (!modelsPromise) {
      modelsPromise = Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri("/models"),      // fast real-time detector
        faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),        // robust fallback + capture
        faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
    }
    modelsPromise.then(() => {
      console.log("[FaceAPI] All models loaded and ready.");
      setModelReady(true);
    });
    return () => stopCamera();
  }, []);

  // ── Camera ────────────────────────────────────────────────────────────────

  const startCamera = async () => {
    if (!videoRef.current) return false;
    if (streamRef.current) return true;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }
      });
    } catch {
      console.warn("[Camera] Ideal constraints rejected, using default.");
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    }

    streamRef.current = stream;
    videoRef.current.srcObject = stream;

    await new Promise((resolve) => {
      videoRef.current.onloadedmetadata = () => {
        videoRef.current.play().then(resolve).catch(resolve);
      };
    });

    // Extra warmup so the first frame is properly exposed
    await new Promise((r) => setTimeout(r, 400));
    return true;
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  // ── Liveness Detection ────────────────────────────────────────────────────
  /**
   * Strategy (fast & reliable):
   * Use TinyFaceDetector for real-time polling (much faster than SSD MobileNet).
   * Pass liveness when we confirm the face is present in 5 consecutive frames.
   * 5 frames at ~80ms each = ~400ms to confirm a live person.
   *
   * Why this works:
   *  - A printed photo won't be detected as consistently across frames (lighting flicker, blur)
   *  - A real live face in front of a webcam gives stable consistent detections
   *  - No EAR blink required — simpler = more reliable for all users
   */
  const detectLiveness = async ({ timeout = 8000 } = {}) => {
    const NEEDED_CONSECUTIVE = 5;   // frames in a row with face = live
    const POLL_INTERVAL      = 80;  // ms between frames
    const start = Date.now();

    let consecutiveDetections = 0;
    let totalFrames = 0;

    const tinyOpts = new faceapi.TinyFaceDetectorOptions({
      inputSize: 224,    // smaller = faster (valid values: 128, 160, 224, 320, 416, 512, 608)
      scoreThreshold: 0.3
    });

    while (Date.now() - start < timeout) {
      totalFrames++;
      let detected = false;

      try {
        const result = await faceapi.detectSingleFace(videoRef.current, tinyOpts);
        detected = !!result;
      } catch (err) {
        console.warn("[Liveness] Detection error on frame", totalFrames, err.message);
      }

      if (detected) {
        consecutiveDetections++;
        setFacing(true);
        console.log(`[Liveness] Frame ${totalFrames}: face detected (${consecutiveDetections}/${NEEDED_CONSECUTIVE} consecutive)`);

        if (consecutiveDetections >= NEEDED_CONSECUTIVE) {
          console.log("[Liveness] ✅ Liveness confirmed! Live face present.");
          return true;
        }
      } else {
        if (consecutiveDetections > 0) {
          console.log(`[Liveness] Frame ${totalFrames}: face lost — resetting consecutive count (was ${consecutiveDetections})`);
        }
        consecutiveDetections = 0; // reset streak on any miss
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }

    console.warn(`[Liveness] ❌ Timeout. Best streak: ${consecutiveDetections}/${NEEDED_CONSECUTIVE}`);
    setFacing(false);
    return false;
  };

  // ── Face Capture ──────────────────────────────────────────────────────────
  /**
   * Uses SsdMobilenetv1 (more accurate) for the final descriptor extraction.
   * Retries up to 3 times to handle transient detection failures.
   */
  const captureFace = async () => {
    if (!modelReady) throw new Error("Face models not loaded yet");

    const ssdOpts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });

    for (let attempt = 1; attempt <= 3; attempt++) {
      const detection = await faceapi
        .detectSingleFace(videoRef.current, ssdOpts)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (detection) {
        console.log(`[Capture] ✅ Face captured on attempt ${attempt}`);
        return Array.from(detection.descriptor); // 128D embedding
      }

      console.warn(`[Capture] Attempt ${attempt} failed — retrying in 300ms...`);
      await new Promise((r) => setTimeout(r, 300));
    }

    throw new Error("No face detected after 3 capture attempts. Please re-centre your face.");
  };

  return { videoRef, startCamera, stopCamera, detectLiveness, captureFace, facing, modelReady };
}