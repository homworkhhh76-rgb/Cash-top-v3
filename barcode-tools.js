(function () {
  'use strict';

  const DEFAULT_FORMATS = [
    'aztec', 'code_128', 'code_39', 'code_93', 'codabar', 'data_matrix',
    'ean_13', 'ean_8', 'itf', 'pdf417', 'qr_code', 'upc_a', 'upc_e'
  ];

  const IS_IOS = /iPad|iPhone|iPod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);

  function isPermissionError(error) {
    const name = String(error?.name || '');
    return name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError';
  }

  function getErrorMessage(error) {
    const name = String(error?.name || '');
    const code = String(error?.message || error || '');
    if (code === 'CAMERA_UNSUPPORTED') return 'هذا المتصفح لا يوفّر وصولاً مباشراً للكاميرا. استخدم زر التقاط صورة للباركود.';
    if (code === 'NO_BARCODE_ENGINE') return 'تعذر تحميل محرك قراءة الباركود. افتح النظام مرة واحدة مع الإنترنت ليتم حفظه في الكاش.';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return IS_IOS
        ? 'تم رفض صلاحية الكاميرا. اسمح للكاميرا لهذا الموقع من إعدادات Safari/الموقع في الآيفون ثم أعد المحاولة، أو استخدم التقاط صورة.'
        : 'تم رفض صلاحية الكاميرا. اسمح للكاميرا لهذا الموقع من إعدادات المتصفح ثم أعد المحاولة، أو استخدم التقاط صورة.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'لم يتم العثور على كاميرا في هذا الجهاز.';
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'الكاميرا مستخدمة في تطبيق آخر أو تعذر تشغيلها. أغلق التطبيق الآخر ثم أعد المحاولة.';
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return 'تعذر تشغيل الكاميرا الخلفية بهذه الإعدادات. سيتم استخدام وضع متوافق مع الجهاز.';
    if (name === 'SecurityError' || (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1')) {
      return 'تشغيل الكاميرا يحتاج فتح النظام عبر HTTPS. لا يمكن للمتصفح منح الكاميرا لصفحة HTTP عادية.';
    }
    return 'تعذر تشغيل كاميرا الباركود. تحقق من صلاحية الكاميرا ثم أعد المحاولة، أو استخدم التقاط صورة.';
  }

  function ensureSecureCameraContext() {
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      throw Object.assign(new Error('INSECURE_CONTEXT'), { name: 'SecurityError' });
    }
  }

  async function openBestCameraStream() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('CAMERA_UNSUPPORTED');
    const attempts = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: 'environment' }, audio: false },
      { video: true, audio: false }
    ];
    let lastError = null;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        lastError = error;
        if (isPermissionError(error) || String(error?.name || '') === 'NotReadableError') throw error;
      }
    }
    throw lastError || new Error('CAMERA_UNSUPPORTED');
  }

  async function requestPermission() {
    ensureSecureCameraContext();
    const stream = await openBestCameraStream();
    stream.getTracks().forEach(track => track.stop());
    return true;
  }

  function playCameraSound(url = 'qr.mp3') {
    try {
      const sound = new Audio(url);
      sound.preload = 'auto';
      sound.volume = 1;
      const promise = sound.play();
      if (promise?.catch) promise.catch(() => null);
    } catch (_) {}
  }

  function clearContainer(container) {
    if (!container) return;
    container.querySelectorAll('video').forEach(video => {
      try { video.pause(); } catch (_) {}
      try { video.srcObject = null; } catch (_) {}
    });
    container.innerHTML = '';
  }

  function tuneVideoForMobile(container) {
    const video = container?.querySelector?.('video');
    if (!video) return;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('autoplay', '');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.maxHeight = '58vh';
    video.style.objectFit = 'cover';
    video.style.background = '#000';
  }

  async function createBarcodeDetector() {
    if (!('BarcodeDetector' in window)) return null;
    const formats = typeof BarcodeDetector.getSupportedFormats === 'function'
      ? await BarcodeDetector.getSupportedFormats().catch(() => DEFAULT_FORMATS)
      : DEFAULT_FORMATS;
    try {
      return new BarcodeDetector({ formats: formats.length ? formats : DEFAULT_FORMATS });
    } catch (_) {
      try { return new BarcodeDetector(); } catch (_) { return null; }
    }
  }

  async function startNativeScanner(container, onDetected, onError, continuous = false) {
    const detector = await createBarcodeDetector();
    if (!detector) throw new Error('NO_NATIVE_BARCODE_DETECTOR');
    const stream = await openBestCameraStream();

    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('autoplay', '');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.maxHeight = '58vh';
    video.style.objectFit = 'cover';
    video.style.background = '#000';
    container.innerHTML = '';
    container.appendChild(video);
    video.srcObject = stream;

    try {
      await video.play();
    } catch (error) {
      stream.getTracks().forEach(track => track.stop());
      throw error;
    }

    let stopped = false;
    let lastScanAt = 0;
    let animationFrame = 0;
    let busy = false;
    let lastDetectedValue = '';
    let lastDetectedAt = 0;

    const stop = async () => {
      if (stopped) return;
      stopped = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      stream.getTracks().forEach(track => track.stop());
      try { video.pause(); } catch (_) {}
      try { video.srcObject = null; } catch (_) {}
      clearContainer(container);
    };

    const loop = async timestamp => {
      if (stopped) return;
      animationFrame = requestAnimationFrame(loop);
      if (busy || video.readyState < 2 || timestamp - lastScanAt < (IS_IOS ? 150 : 110)) return;
      lastScanAt = timestamp;
      busy = true;
      try {
        const results = await detector.detect(video);
        const value = String(results?.[0]?.rawValue || '').trim();
        const now = Date.now();
        if (value) {
          const isDuplicateStillInView = continuous && value === lastDetectedValue;
          lastDetectedAt = now;
          if (!isDuplicateStillInView) {
            lastDetectedValue = value;
            if (!continuous) await stop();
            onDetected(value);
          }
        } else if (continuous && lastDetectedValue && now - lastDetectedAt > 700) {
          lastDetectedValue = '';
        }
      } catch (error) {
        if (!stopped && String(error?.name || '') !== 'InvalidStateError') onError?.(error);
      } finally {
        busy = false;
      }
    };
    animationFrame = requestAnimationFrame(loop);
    return { stop, mode: 'live-native' };
  }

  function pickRearCamera(cameras) {
    const list = Array.isArray(cameras) ? cameras : [];
    if (!list.length) return null;
    const scored = list.map((camera, index) => {
      const label = String(camera?.label || '').toLowerCase();
      let score = 0;
      if (/(back|rear|environment|world|traseira|arrière|hinten|خلف|خلفية)/i.test(label)) score += 1000;
      if (/(wide|واسع)/i.test(label)) score += 260;
      if (/(ultra|0\.5|telephoto|tele|front|user|أمامي)/i.test(label)) score -= 520;
      if (/(camera|كاميرا)/i.test(label)) score += 40;
      return { camera, score, index };
    });
    scored.sort((a, b) => (b.score - a.score) || (b.index - a.index));
    return scored[0]?.camera || list[list.length - 1] || list[0];
  }

  function getHtml5QrcodeFormats() {
    const formats = window.Html5QrcodeSupportedFormats;
    if (!formats) return undefined;
    const preferredNames = [
      'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E',
      'CODE_128', 'CODE_39', 'CODE_93', 'CODABAR', 'ITF',
      'QR_CODE', 'DATA_MATRIX'
    ];
    const values = preferredNames
      .map(name => formats[name])
      .filter(value => typeof value === 'number');
    return values.length ? values : undefined;
  }

  function createHtml5QrcodeReader(elementId) {
    const config = {
      verbose: false,
      // مهم للآيفون: BarcodeDetector الأصلي في WebKit قد يفتح الكاميرا لكن يفشل
      // في فك كثير من باركودات المتاجر 1D. نجبر html5-qrcode على ZXing في iOS.
      useBarCodeDetectorIfSupported: !IS_IOS
    };
    const formats = getHtml5QrcodeFormats();
    if (formats) config.formatsToSupport = formats;
    return new window.Html5Qrcode(elementId, config);
  }

  async function optimizeVideoTrackForBarcode(container) {
    const video = container?.querySelector?.('video');
    const track = video?.srcObject?.getVideoTracks?.()?.[0];
    if (!track) return;
    try {
      const capabilities = track.getCapabilities?.() || {};
      const advanced = [];
      if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
        advanced.push({ focusMode: 'continuous' });
      }
      // لا نفرض Zoom مرتفعاً على iPhone Pro لأنه قد يزيد ضبابية الباركود القريب.
      if (advanced.length) await track.applyConstraints({ advanced });
    } catch (_) {}
  }

  async function startHtml5Scanner(container, onDetected, onError, continuous = false) {
    if (typeof window.Html5Qrcode !== 'function') throw new Error('NO_BARCODE_ENGINE');
    if (!container.id) container.id = `ct_barcode_reader_${Date.now()}`;
    clearContainer(container);

    let instance = createHtml5QrcodeReader(container.id);
    let stopped = false;
    let detected = false;
    let lastDetectedValue = '';
    let lastDetectedAt = 0;

    const stop = async () => {
      if (stopped) return;
      stopped = true;
      try {
        if (instance?.isScanning) await instance.stop();
      } catch (_) {}
      try { instance?.clear?.(); } catch (_) {}
      clearContainer(container);
    };

    const scannerConfig = {
      // تقليل الضغط على WebKit يعطي ZXing وقتاً كافياً لتحليل كل إطار بدل إسقاط الإطارات.
      fps: IS_IOS ? 10 : 18,
      // منطقة عريضة ديناميكية لباركودات EAN/UPC/CODE128 الطويلة على شاشة الآيفون.
      qrbox: IS_IOS
        ? ((viewfinderWidth, viewfinderHeight) => {
            const width = Math.max(180, Math.min(Math.floor(viewfinderWidth * 0.92), Math.floor(viewfinderWidth - 12)));
            const height = Math.max(100, Math.min(
              Math.floor(viewfinderHeight * 0.42),
              Math.floor(viewfinderWidth * 0.48),
              Math.floor(viewfinderHeight - 12)
            ));
            return { width, height };
          })
        : {
            width: Math.min(320, Math.max(210, Number(container.clientWidth || 320) - 28)),
            height: 165
          },
      disableFlip: false
    };

    const onSuccess = async decodedText => {
      const value = String(decodedText || '').trim();
      if (!value) return;
      const now = Date.now();
      if (continuous) {
        lastDetectedAt = now;
        if (value === lastDetectedValue) return;
        lastDetectedValue = value;
        onDetected(value);
        return;
      }
      if (detected) return;
      detected = true;
      await stop();
      onDetected(value);
    };

    const onScanFailure = () => {
      if (continuous && lastDetectedValue && Date.now() - lastDetectedAt > 700) lastDetectedValue = '';
    };

    async function startWith(cameraConfig) {
      await instance.start(cameraConfig, scannerConfig, onSuccess, onScanFailure);
      tuneVideoForMobile(container);
      await optimizeVideoTrackForBarcode(container);
      // بعض إصدارات WebKit تنشئ الفيديو بعد اكتمال start مباشرة بقليل.
      setTimeout(() => {
        tuneVideoForMobile(container);
        optimizeVideoTrackForBarcode(container);
      }, 120);
    }

    try {
      await startWith({ facingMode: 'environment' });
    } catch (firstError) {
      if (isPermissionError(firstError)) throw firstError;
      let cameras = [];
      try { cameras = await window.Html5Qrcode.getCameras(); } catch (_) {}
      const rear = pickRearCamera(cameras);
      if (!rear?.id) throw firstError;
      try { instance.clear(); } catch (_) {}
      instance = createHtml5QrcodeReader(container.id);
      await startWith(rear.id);
    }

    return { stop, mode: 'live-html5' };
  }

  async function decodeBarcodeImage(file) {
    if (!file) throw new Error('NO_IMAGE');

    const detector = IS_IOS ? null : await createBarcodeDetector();
    if (detector && typeof createImageBitmap === 'function') {
      let bitmap = null;
      try {
        bitmap = await createImageBitmap(file);
        const results = await detector.detect(bitmap);
        const value = String(results?.[0]?.rawValue || '').trim();
        if (value) return value;
      } catch (_) {
      } finally {
        try { bitmap?.close?.(); } catch (_) {}
      }
    }

    if (typeof window.Html5Qrcode === 'function') {
      const hidden = document.createElement('div');
      hidden.id = `ct_barcode_file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      hidden.style.position = 'fixed';
      hidden.style.left = '-10000px';
      hidden.style.top = '-10000px';
      hidden.style.width = '1px';
      hidden.style.height = '1px';
      hidden.style.overflow = 'hidden';
      document.body.appendChild(hidden);
      const reader = createHtml5QrcodeReader(hidden.id);
      try {
        return String(await reader.scanFile(file, true) || '').trim();
      } finally {
        try { reader.clear(); } catch (_) {}
        hidden.remove();
      }
    }

    throw new Error('NO_BARCODE_ENGINE');
  }

  function createPhotoFallback(container, onDetected, onError, continuous, message) {
    clearContainer(container);
    let stopped = false;

    const box = document.createElement('div');
    box.style.cssText = 'width:100%;min-height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px;text-align:center;background:#111827;color:#fff;';

    const icon = document.createElement('div');
    icon.innerHTML = '<span style="font-size:38px;line-height:1">📷</span>';

    const text = document.createElement('div');
    text.style.cssText = 'font-size:13px;line-height:1.8;max-width:330px;';
    text.textContent = `${message || 'تعذر تشغيل البث المباشر.'} يمكنك تصوير الباركود بالكاميرا وسيتم قراءته مباشرة.`;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'فتح الكاميرا والتقاط صورة للباركود';
    button.style.cssText = 'border:0;border-radius:8px;padding:11px 16px;background:#0ea5e9;color:#fff;font:inherit;font-weight:700;cursor:pointer;touch-action:manipulation;';
    button.addEventListener('click', () => {
      if (!stopped) input.click();
    });

    const status = document.createElement('div');
    status.style.cssText = 'font-size:12px;color:#cbd5e1;min-height:20px;';

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file || stopped) return;
      button.disabled = true;
      status.textContent = 'جاري قراءة الباركود من الصورة...';
      try {
        const value = await decodeBarcodeImage(file);
        if (!value) throw new Error('BARCODE_NOT_FOUND');
        if (!continuous) await stop();
        onDetected(value);
        if (continuous && !stopped) status.textContent = 'تمت القراءة. يمكنك تصوير باركود آخر.';
      } catch (error) {
        const fallbackMessage = String(error?.message || '') === 'BARCODE_NOT_FOUND'
          ? 'لم يظهر باركود واضح في الصورة. قرّب الكاميرا وحاول مرة أخرى.'
          : getErrorMessage(error);
        status.textContent = fallbackMessage;
        onError?.(error, fallbackMessage);
      } finally {
        if (!stopped) button.disabled = false;
      }
    });

    box.append(icon, text, button, input, status);
    container.appendChild(box);

    async function stop() {
      if (stopped) return;
      stopped = true;
      input.value = '';
      clearContainer(container);
    }

    return { stop, mode: 'photo-fallback' };
  }

  async function startCameraScanner(options = {}) {
    const container = typeof options.container === 'string'
      ? document.getElementById(options.container)
      : options.container;
    if (!container) throw new Error('SCANNER_CONTAINER_NOT_FOUND');
    const onDetected = typeof options.onDetected === 'function' ? options.onDetected : () => {};
    const onError = typeof options.onError === 'function' ? options.onError : () => {};

    let controller = null;
    let cancelled = false;
    const pendingController = {
      get mode() { return controller?.mode || 'starting'; },
      async stop() {
        cancelled = true;
        if (controller?.stop) await controller.stop();
        clearContainer(container);
      }
    };

    try {
      ensureSecureCameraContext();
      const detected = value => {
        if (!value || cancelled) return;
        if (options.sound !== false) playCameraSound(options.soundUrl || 'qr.mp3');
        onDetected(value);
      };
      const continuous = options.continuous === true;

      // لا نطلب getUserMedia مرتين. هذا مهم خصوصاً على iPhone/WebKit.
      // نستخدم BarcodeDetector إن كان متاحاً، وإلا ننتقل مباشرة إلى html5-qrcode.
      if ('BarcodeDetector' in window && !IS_IOS) {
        try {
          controller = await startNativeScanner(container, detected, onError, continuous);
        } catch (nativeError) {
          if (isPermissionError(nativeError)) throw nativeError;
          controller = await startHtml5Scanner(container, detected, onError, continuous);
        }
      } else {
        // على iPhone/iPad نفضّل ZXing داخل html5-qrcode لدعم باركود المتاجر 1D بصورة أوسع.
        controller = await startHtml5Scanner(container, detected, onError, continuous);
      }

      if (cancelled) await controller.stop();
      return pendingController;
    } catch (error) {
      clearContainer(container);
      const message = getErrorMessage(error);
      onError(error, message);
      if (options.photoFallback !== false) {
        controller = createPhotoFallback(container, value => {
          if (options.sound !== false) playCameraSound(options.soundUrl || 'qr.mp3');
          onDetected(value);
        }, onError, options.continuous === true, message);
        if (cancelled) await controller.stop();
        return pendingController;
      }
      throw error;
    }
  }

  function isEditable(element) {
    return Boolean(element && (element.matches?.('input, textarea, select') || element.isContentEditable));
  }

  function bindHardwareScanner(options = {}) {
    const onScan = typeof options.onScan === 'function' ? options.onScan : () => {};
    const minLength = Math.max(2, Number(options.minLength || 3));
    const maxGap = Math.max(25, Number(options.maxGap || 95));
    const resetAfter = Math.max(maxGap + 20, Number(options.resetAfter || 180));
    let buffer = '';
    let firstAt = 0;
    let lastAt = 0;
    let timer = 0;

    const reset = () => {
      buffer = '';
      firstAt = 0;
      lastAt = 0;
      if (timer) clearTimeout(timer);
      timer = 0;
    };

    const listener = event => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      const now = performance.now();
      if (event.key === 'Enter' || event.key === 'Tab') {
        const code = buffer.trim();
        const duration = firstAt ? now - firstAt : Number.POSITIVE_INFINITY;
        const avgGap = code.length > 1 ? duration / (code.length - 1) : duration;
        const rapid = code.length >= minLength && avgGap <= maxGap;
        const active = document.activeElement;
        const direct = typeof options.isDirectField === 'function' && options.isDirectField(active);
        if (rapid && !direct) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (isEditable(active) && typeof active.value === 'string') {
            const current = String(active.value);
            if (current === code || current.endsWith(code)) active.value = current.slice(0, Math.max(0, current.length - code.length));
          }
          onScan(code, { source: 'hardware', activeElement: active });
        }
        reset();
        return;
      }
      if (event.key.length !== 1) return;
      if (!buffer || now - lastAt > resetAfter) {
        buffer = '';
        firstAt = now;
      }
      buffer += event.key;
      lastAt = now;
      if (timer) clearTimeout(timer);
      timer = setTimeout(reset, resetAfter);
    };

    document.addEventListener('keydown', listener, true);
    return () => document.removeEventListener('keydown', listener, true);
  }

  function bindBarcodeFieldEnter(selector, callback) {
    const listener = event => {
      const target = event.target;
      if (event.key !== 'Enter' || !target?.matches?.(selector)) return;
      event.preventDefault();
      event.stopPropagation();
      const value = String(target.value || '').trim();
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      callback?.(value, target);
    };
    document.addEventListener('keydown', listener, true);
    return () => document.removeEventListener('keydown', listener, true);
  }

  window.CashtopBarcode = {
    requestPermission,
    startCameraScanner,
    bindHardwareScanner,
    bindBarcodeFieldEnter,
    playCameraSound,
    getErrorMessage,
    isIOS: IS_IOS
  };
})();
