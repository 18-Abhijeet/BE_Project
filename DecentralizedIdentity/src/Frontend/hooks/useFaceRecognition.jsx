// frontend/src/hooks/useFaceRecognition.js
import { useRef, useState, useEffect } from "react";
import * as faceapi from "face-api.js";

export default function useFaceRecognition() {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);

  const [modelReady, setModelReady] = useState(false);
  const [facing,     setFacing]     = useState(false);

  // Load models once on mount
  useEffect(() => {
    const loadModels = async () => {
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),
        faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
      setModelReady(true);
    };
    loadModels();
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    if (!videoRef.current) return false;
    if (streamRef.current) return true;
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    streamRef.current = stream;
    videoRef.current.srcObject = stream;
    // Wait for video to be actually playing before returning
    await new Promise((resolve) => {
      videoRef.current.onloadedmetadata = () => {
        videoRef.current.play().then(resolve);
      };
    });
    return true;
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  /**
   * Real liveness detection using EAR (Eye Aspect Ratio) blink detection.
   * A photo or static image will NOT pass — requires an actual blink.
   *
   * EAR = (‖p2−p6‖ + ‖p3−p5‖) / (2 × ‖p1−p4‖)
   * Blink = EAR drops below threshold then rises back above it.
   */
  const detectLiveness = async ({ timeout = 8000 } = {}) => {
    const EAR_THRESHOLD  = 0.22; // below this = eye closed
    const EAR_OPEN_RESET = 0.27; // above this after closing = blink confirmed
    const POLL_INTERVAL  = 100;  // ms between checks

    let eyeWasClosed = false;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const detection = await faceapi
        .detectSingleFace(videoRef.current)
        .withFaceLandmarks();

      if (detection) {
        setFacing(true);
        const lm = detection.landmarks;
        const leftEAR  = eyeAspectRatio(lm.getLeftEye());
        const rightEAR = eyeAspectRatio(lm.getRightEye());
        const ear = (leftEAR + rightEAR) / 2;

        if (ear < EAR_THRESHOLD) {
          eyeWasClosed = true;
        } else if (eyeWasClosed && ear > EAR_OPEN_RESET) {
          // Eyes opened after being closed — confirmed blink
          return true;
        }
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }

    setFacing(false);
    return false;
  };

  const captureFace = async () => {
    if (!modelReady) throw new Error("Face models not loaded yet");

    const detection = await faceapi
      .detectSingleFace(videoRef.current)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) throw new Error("No face detected during capture");
    return Array.from(detection.descriptor); // 128D embedding
  };

  return { videoRef, startCamera, stopCamera, detectLiveness, captureFace, facing, modelReady };
}

// ── EAR helper ────────────────────────────────────────────────────────────────
// Points follow face-api landmark indexing for a single eye (6 points)
function eyeAspectRatio(eye) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const A = dist(eye[1], eye[5]);
  const B = dist(eye[2], eye[4]);
  const C = dist(eye[0], eye[3]);
  return (A + B) / (2 * C);
}