/**
 * 음성 알림 시스템 (Web Audio API)
 * Day 38-40 구현
 *
 * 기능:
 * - 텍스트 음성 변환 (TTS)
 * - 알림 타입별 다양한 음성
 * - 음량/속도 조절
 * - 브라우저 호환성
 */

/**
 * 음성 알림 타입
 */
export const NOTIFICATION_TYPES = {
  SUCCESS: "success",      // 성공 (긍정적 음성)
  WARNING: "warning",      // 경고 (주의 음성)
  ERROR: "error",          // 오류 (긴급 음성)
  INFO: "info",            // 정보 (중립 음성)
  SYNC: "sync",            // 동기화 (진행 음성)
};

/**
 * 음성 알림 설정
 */
export const VOICE_CONFIG = {
  lang: "ko-KR",           // 한국어
  rate: 1.0,               // 속도 (0.1~10)
  pitch: 1.0,              // 음높이 (0.1~2)
  volume: 0.8,             // 음량 (0~1)
};

/**
 * 알림 메시지 템플릿
 */
const NOTIFICATION_MESSAGES = {
  [NOTIFICATION_TYPES.SUCCESS]: {
    message: "영수증이 성공적으로 저장되었습니다.",
    pitch: 1.1,
    rate: 1.0,
  },
  [NOTIFICATION_TYPES.WARNING]: {
    message: "충돌이 감지되었습니다. 확인이 필요합니다.",
    pitch: 1.3,
    rate: 0.9,
  },
  [NOTIFICATION_TYPES.ERROR]: {
    message: "오류가 발생했습니다. 다시 시도해주세요.",
    pitch: 0.8,
    rate: 0.85,
  },
  [NOTIFICATION_TYPES.INFO]: {
    message: "준비가 완료되었습니다.",
    pitch: 1.0,
    rate: 1.0,
  },
  [NOTIFICATION_TYPES.SYNC]: {
    message: "동기화 중입니다.",
    pitch: 1.05,
    rate: 1.0,
  },
};

/**
 * 음성 알림 재생 여부
 */
class VoiceNotificationManager {
  constructor() {
    this.enabled = this.getPreference();
    this.isSpeaking = false;
    this.utterances = [];
  }

  /**
   * 설정에서 음성 알림 여부 조회
   */
  getPreference() {
    if (typeof localStorage === "undefined") {
      return true; // 기본값
    }
    const pref = localStorage.getItem("voice-notification-enabled");
    return pref !== "false";
  }

  /**
   * 음성 알림 활성화/비활성화
   */
  setPreference(enabled) {
    this.enabled = enabled;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("voice-notification-enabled", String(enabled));
    }
    console.log(`🔊 음성 알림: ${enabled ? "활성화" : "비활성화"}`);
  }
}

export const voiceManager = new VoiceNotificationManager();

/**
 * 음성 알림 재생
 * @param {string} type - 알림 타입
 * @param {string} customMessage - 사용자 정의 메시지 (선택)
 */
export async function playNotification(type = NOTIFICATION_TYPES.INFO, customMessage = null) {
  // 음성 알림 비활성화 상태 확인
  if (!voiceManager.enabled) {
    console.log("🔇 음성 알림 비활성화");
    return;
  }

  // 브라우저 음성 API 확인
  if (typeof window === "undefined" || !window.speechSynthesis) {
    console.warn("⚠️ 음성 API 미지원");
    return;
  }

  try {
    const template = NOTIFICATION_MESSAGES[type] || NOTIFICATION_MESSAGES[NOTIFICATION_TYPES.INFO];
    const message = customMessage || template.message;

    console.log(`🔊 음성 재생: ${message}`);

    // 음성 합성 객체 생성
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = VOICE_CONFIG.lang;
    utterance.rate = VOICE_CONFIG.rate;
    utterance.pitch = template.pitch || VOICE_CONFIG.pitch;
    utterance.volume = VOICE_CONFIG.volume;

    // 이벤트 리스너
    utterance.onstart = () => {
      voiceManager.isSpeaking = true;
      console.log("▶️ 음성 재생 시작");
    };

    utterance.onend = () => {
      voiceManager.isSpeaking = false;
      console.log("⏹️ 음성 재생 완료");
    };

    utterance.onerror = (event) => {
      console.error(`❌ 음성 오류: ${event.error}`);
      voiceManager.isSpeaking = false;
    };

    // 현재 음성 중단 및 새로운 음성 재생
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);

    voiceManager.utterances.push(utterance);

  } catch (error) {
    console.error(`❌ 음성 재생 실패: ${error.message}`);
  }
}

/**
 * 사용자 정의 메시지 음성 재생
 * @param {string} message - 재생할 메시지
 * @param {Object} options - 옵션 (rate, pitch, volume)
 */
export async function speak(message, options = {}) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    console.warn("⚠️ 음성 API 미지원");
    return;
  }

  try {
    console.log(`🔊 말하기: ${message}`);

    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = VOICE_CONFIG.lang;
    utterance.rate = options.rate || VOICE_CONFIG.rate;
    utterance.pitch = options.pitch || VOICE_CONFIG.pitch;
    utterance.volume = options.volume || VOICE_CONFIG.volume;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);

  } catch (error) {
    console.error(`❌ 말하기 실패: ${error.message}`);
  }
}

/**
 * 현재 음성 중단
 */
export function stopSpeaking() {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
    voiceManager.isSpeaking = false;
    console.log("⏹️ 음성 중단");
  }
}

/**
 * 알림 재생 (음성 + 시각적 피드백)
 * @param {string} type - 알림 타입
 * @param {string} message - 메시지
 * @param {number} duration - 표시 시간 (ms)
 */
export async function showNotification(type, message, duration = 3000) {
  // 음성 알림
  await playNotification(type, message);

  // 시각적 피드백 (토스트/스넥바)
  if (typeof document !== "undefined") {
    const toast = document.createElement("div");
    toast.className = `notification notification-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      background: ${getBackgroundColor(type)};
      color: white;
      padding: 16px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-size: 14px;
      z-index: 9999;
      animation: slideIn 0.3s ease-out;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = "slideOut 0.3s ease-out";
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  console.log(`📢 알림: [${type}] ${message}`);
}

/**
 * 타입별 배경 색상
 */
function getBackgroundColor(type) {
  const colors = {
    [NOTIFICATION_TYPES.SUCCESS]: "#10b981",  // 녹색
    [NOTIFICATION_TYPES.WARNING]: "#f59e0b",  // 주황색
    [NOTIFICATION_TYPES.ERROR]: "#ef4444",    // 빨강색
    [NOTIFICATION_TYPES.INFO]: "#3b82f6",     // 파란색
    [NOTIFICATION_TYPES.SYNC]: "#8b5cf6",     // 보라색
  };
  return colors[type] || colors[NOTIFICATION_TYPES.INFO];
}

/**
 * 사용 가능한 음성 언어 확인
 */
export async function getAvailableVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return [];
  }

  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        resolve(window.speechSynthesis.getVoices());
      };
    }
  });
}

/**
 * 한국어 음성 설정
 */
export async function setKoreanVoice() {
  try {
    const voices = await getAvailableVoices();
    const koreanVoice = voices.find(
      voice => voice.lang.startsWith("ko-KR") || voice.lang.startsWith("ko")
    );

    if (koreanVoice) {
      console.log(`✅ 한국어 음성: ${koreanVoice.name}`);
      return koreanVoice;
    } else {
      console.warn("⚠️ 한국어 음성을 찾을 수 없습니다");
      return voices[0] || null;
    }

  } catch (error) {
    console.error(`❌ 음성 설정 오류: ${error.message}`);
    return null;
  }
}
