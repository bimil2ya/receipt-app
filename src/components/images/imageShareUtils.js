const isAndroidUserAgent = (userAgent) => /Android/i.test(userAgent || '');

export function buildImageReceipts(receipts) {
  const byImageId = new Map();
  const sorted = [...(Array.isArray(receipts) ? receipts : [])]
    .filter((receipt) => receipt?.imageId)
    .sort((a, b) => {
      const byDate = (b.date || '').localeCompare(a.date || '');
      if (byDate !== 0) return byDate;
      return (b.useTime || '').localeCompare(a.useTime || '');
    });

  for (const receipt of sorted) {
    if (!byImageId.has(receipt.imageId)) byImageId.set(receipt.imageId, receipt);
  }

  return [...byImageId.values()];
}

export function buildReceiptImageFileName(receipt, index, ext) {
  const safeStoreName = String(receipt?.storeName || '영수증')
    .replace(/[/\\:*?"<>|]/g, '_')
    .slice(0, 18);
  return `${receipt?.date || '날짜없음'}_${safeStoreName}_${String(index + 1).padStart(2, '0')}.${ext}`;
}

export function getReceiptImageExt(blobType) {
  return String(blobType || '').includes('png') ? 'png' : 'jpg';
}

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} 이미지를 불러오지 못했습니다.`));
    };
    img.src = url;
  });
}

export async function makeCombinedReceiptFile(files, options = {}) {
  const {
    userAgent = navigator.userAgent,
    documentRef = document,
    now = new Date(),
  } = options;
  const images = await Promise.all(files.map(loadImageFromFile));
  const isAndroid = isAndroidUserAgent(userAgent);
  const padding = isAndroid ? 28 : 36;
  const labelHeight = isAndroid ? 52 : 58;
  const gap = isAndroid ? 20 : 28;
  const baseWidth = isAndroid ? 1200 : 1400;

  const getLayout = (contentWidth) => {
    const items = images.map((img, index) => {
      const scale = Math.min(1, contentWidth / img.naturalWidth);
      return {
        img,
        file: files[index],
        width: Math.round(img.naturalWidth * scale),
        height: Math.round(img.naturalHeight * scale),
      };
    });
    const totalHeight = padding + items.reduce((sum, item) => sum + labelHeight + item.height + gap, 0) + padding;
    return { items, totalHeight };
  };

  let outputWidth = baseWidth;
  let layout = getLayout(outputWidth - padding * 2);
  const maxHeight = isAndroid ? 20000 : 28000;
  if (layout.totalHeight > maxHeight) {
    const ratio = maxHeight / layout.totalHeight;
    outputWidth = Math.max(420, Math.floor(baseWidth * ratio));
    layout = getLayout(outputWidth - padding * 2);
  }

  const canvas = documentRef.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = layout.totalHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'middle';

  let y = padding;
  layout.items.forEach((item, index) => {
    ctx.fillStyle = '#0f172a';
    ctx.font = isAndroid ? '700 26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif' : '700 30px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(`${index + 1}. ${item.file.name}`, padding, y + labelHeight / 2);
    y += labelHeight;

    const x = Math.round((canvas.width - item.width) / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 2, y - 2, item.width + 4, item.height + 4);
    ctx.drawImage(item.img, x, y, item.width, item.height);
    y += item.height + gap;
  });

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('영수증 합본 이미지 생성에 실패했습니다.')), 'image/jpeg', 0.86);
  });
  return new File([blob], `영수증_${files.length}장_${now.toISOString().slice(0, 10)}.jpg`, { type: 'image/jpeg' });
}

export function downloadFiles(files, documentRef = document) {
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const a = documentRef.createElement('a');
    a.href = url;
    a.download = file.name;
    documentRef.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}
