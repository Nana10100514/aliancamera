"use strict";

const video = document.getElementById("camera");
const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d");

const startButton = document.getElementById("startButton");
const shootButton = document.getElementById("shootButton");
const flash = document.getElementById("flash");
const preview = document.getElementById("preview");
const resultImage = document.getElementById("resultImage");
const closeButton = document.getElementById("closeButton");
const saveButton = document.getElementById("saveButton");

let stream = null;
let starting = false;
let running = false;
let generation = 0;
let animationId = null;

let firstFrameAt = null;
let nextBlinkAt = 0;
let blinkUntil = 0;
let photoUrl = null;
let takingPhoto = false;

let openImage = null;
let closedImage = null;

// 画像が読み込めなければ再試行できるようにする
function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => {
      reject(new Error(`画像が読み込めません: ${path}`));
    };

    image.src = path;
  });
}

async function prepareImages() {
  if (openImage && closedImage) return;

  [openImage, closedImage] = await Promise.all([
    loadImage("./assets/alien-open.png"),
    loadImage("./assets/alien-closed.png")
  ]);
}

// スマホ画面に合わせる
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

async function startCamera() {
  if (starting || running) return;

  const token = ++generation;
  starting = true;
  startButton.hidden = true;
  shootButton.disabled = true;

  let candidateStream = null;

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("HTTPSでカメラ対応ブラウザから開いてください。");
    }

    // ページを開いたらカメラ許可を要求する
    candidateStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 1920 }
      }
    });

    if (token !== generation) {
      candidateStream.getTracks().forEach(track => track.stop());
      return;
    }

    stream = candidateStream;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    await video.play();

    if (token !== generation) return;

    running = true;
    firstFrameAt = null;
    nextBlinkAt = 0;
    blinkUntil = 0;

    animationId = requestAnimationFrame(draw);

    // 画像の読み込み失敗時も画面には文字を出さない
    try {
      await prepareImages();
    } catch (error) {
      if (token !== generation) return;

      console.error(error);
      startButton.hidden = false;
    }
  } catch (error) {
    candidateStream?.getTracks().forEach(track => track.stop());

    if (token !== generation) return;

    console.error(error);
    stopCamera();
    startButton.hidden = false;
  } finally {
    if (token === generation) starting = false;
  }
}

// カメラと宇宙人を同じcanvasに描画する
// 撮影時にも、この見た目がそのまま保存される
function draw(now) {
  if (!running) return;

  if (video.readyState >= 2 && video.videoWidth > 0) {
    if (firstFrameAt === null) {
      firstFrameAt = now;
      nextBlinkAt = now + 5000;
    }

    const width = canvas.width;
    const height = canvas.height;

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;

    // 画面いっぱいに表示するため、中央で切り抜く
    const ratio = Math.max(
      width / sourceWidth,
      height / sourceHeight
    );

    const cropWidth = width / ratio;
    const cropHeight = height / ratio;

    ctx.drawImage(
      video,
      (sourceWidth - cropWidth) / 2,
      (sourceHeight - cropHeight) / 2,
      cropWidth,
      cropHeight,
      0,
      0,
      width,
      height
    );

    const elapsed = now - firstFrameAt;

    // カメラの最初の映像から3秒後に登場
    if (elapsed >= 3000 && openImage && closedImage) {
      if (now >= nextBlinkAt) {
        blinkUntil = now + 170;
        nextBlinkAt = now + 2200 + Math.random() * 1600;
      }

      const image = now < blinkUntil ? closedImage : openImage;

      // 横画面でも宇宙人が大きくなりすぎないようにする
      const alienWidth = Math.min(width * 0.48, height * 0.48);
      const alienHeight =
        alienWidth * image.naturalHeight / image.naturalWidth;

      const floating = Math.sin(elapsed / 450) * height * 0.014;

      const x = (width - alienWidth) / 2;
      const y = height * 0.43 - alienHeight / 2 + floating;

      // ふわっと登場
      ctx.save();
      ctx.globalAlpha = Math.min(1, (elapsed - 3000) / 450);
      ctx.drawImage(image, x, y, alienWidth, alienHeight);
      ctx.restore();
    }

    shootButton.disabled = takingPhoto;
  }

  animationId = requestAnimationFrame(draw);
}

// 写真を撮影
function takePhoto() {
  if (!running || firstFrameAt === null || takingPhoto) return;

  takingPhoto = true;
  shootButton.disabled = true;

  // 撮影した瞬間のcanvasをコピー
  const photo = document.createElement("canvas");
  photo.width = canvas.width;
  photo.height = canvas.height;
  photo.getContext("2d").drawImage(canvas, 0, 0);

  flash.animate(
    [{ opacity: 0.9 }, { opacity: 0 }],
    { duration: 250, easing: "ease-out" }
  );

  const token = generation;

  photo.toBlob(blob => {
    takingPhoto = false;

    if (!blob || token !== generation) return;

    if (photoUrl) URL.revokeObjectURL(photoUrl);

    photoUrl = URL.createObjectURL(blob);
    resultImage.src = photoUrl;
    saveButton.href = photoUrl;
    saveButton.download = `alien-${Date.now()}.png`;

    preview.hidden = false;
  }, "image/png");
}

shootButton.addEventListener("click", takePhoto);

closeButton.addEventListener("click", () => {
  preview.hidden = true;
});

// カメラ、または画像読み込みの再試行
startButton.addEventListener("click", async () => {
  if (!running) {
    await startCamera();
    return;
  }

  startButton.hidden = true;

  try {
    await prepareImages();
  } catch (error) {
    console.error(error);
    startButton.hidden = false;
  }
});

function stopCamera() {
  generation++;
  starting = false;
  running = false;
  firstFrameAt = null;
  takingPhoto = false;

  cancelAnimationFrame(animationId);

  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  video.srcObject = null;
  shootButton.disabled = true;
}

window.addEventListener("pagehide", () => {
  stopCamera();

  preview.hidden = true;
  resultImage.removeAttribute("src");
  saveButton.removeAttribute("href");

  if (photoUrl) {
    URL.revokeObjectURL(photoUrl);
    photoUrl = null;
  }
});

// 戻る操作でページが復元された場合
window.addEventListener("pageshow", event => {
  if (event.persisted) startCamera();
});

// ページを開いたらすぐ起動
startCamera();