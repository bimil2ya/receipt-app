import imageCompression from 'browser-image-compression';

/**
 * 이미지 압축 및 회전 보정 (순차 처리 필수)
 * v11 전문가 가이드: maxWidthOrHeight 1920 강제 적용하여 iOS 크래시 방지
 */
export async function compressPhoto(file) {
  const options = {
    maxWidthOrHeight: 1920,      // iOS Canvas Pixel Limit 방어
    maxSizeMB: 1,               // 1MB 이하로 압축
    useWebWorker: true,
    exifOrientation: true,       // EXIF 회전값 자동 보정
    onProgress: (percent) => {
      console.log(`압축 진행률: ${percent}%`);
    }
  };

  try {
    return await imageCompression(file, options);
  } catch (error) {
    console.error("압축 중 오류 발생:", error);
    throw error;
  }
}

/**
 * 이미지를 압축하고 Base64 데이터와 MIME 타입을 객체로 반환합니다.
 */
export async function compressToBase64(file) {
  try {
    const compressed = await compressPhoto(file);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (!result || typeof result !== 'string') {
          return reject(new Error("파일을 읽지 못했습니다."));
        }
        
        // 콤마(,)를 기준으로 헤더와 Base64 본문 분리
        const commaIndex = result.indexOf(',');
        if (commaIndex === -1) {
          return reject(new Error("잘못된 데이터 형식입니다."));
        }
        
        const b64 = result.substring(commaIndex + 1);
        
        // MimeType 추출 (예: data:image/jpeg;base64 -> image/jpeg)
        const header = result.substring(0, commaIndex);
        const mimeMatch = header.match(/data:(.*?);/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        
        if (!b64) {
          return reject(new Error("데이터가 비어있습니다."));
        }
        
        resolve({ mimeType, b64 });
      };
      reader.onerror = () => reject(new Error("파일 읽기 오류가 발생했습니다."));
      reader.readAsDataURL(compressed);
    });
  } catch (error) {
    console.error("Base64 압축 중 오류 발생:", error);
    throw error;
  }
}

/**
 * 다중 사진 순차 압축 (for...of 루프 사용 - OOM 방어)
 */
export async function compressPhotosSequentially(files) {
  const compressedFiles = [];
  for (const file of files) {
    const compressed = await compressPhoto(file);
    compressedFiles.push(compressed);
  }
  return compressedFiles;
}
