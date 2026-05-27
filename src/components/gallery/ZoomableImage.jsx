import { useState, useRef, useEffect } from 'react';

export default function ZoomableImage({ src, alt, initialRotation = 0, onRotate }) {
  const [displaySrc, setDisplaySrc] = useState(src);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [userRot, setUserRot] = useState(initialRotation);
  const ref = useRef();
  const st = useRef({ dist: null, lastXY: null, scale: 1, pos: { x: 0, y: 0 }, rot: initialRotation });

  // 린트 에러 해결: initialRotation 변경 시 상태 동기화
  useEffect(() => {
    st.current.rot = initialRotation;
    st.current.scale = 1;
    st.current.pos = { x: 0, y: 0 };
    // 상태 업데이트를 다음 틱으로 미루어 연쇄 렌더링 방지
    setTimeout(() => {
      setUserRot(initialRotation);
      setScale(1);
      setPos({ x: 0, y: 0 });
    }, 0);
  }, [initialRotation]);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    (async () => {
      try {
        let orientation = 1;
        const isJpeg = src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg');
        if (isJpeg) {
          const b64 = src.split(',')[1];
          if (b64) {
            try {
              const cleanB64 = b64.replace(/[^A-Za-z0-9+/=]/g, '');
              const raw = atob(cleanB64.substring(0, Math.min(cleanB64.length, 87381)));
              const buf = new ArrayBuffer(raw.length);
              const u8 = new Uint8Array(buf);
              for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
              const view = new DataView(buf);
              if (view.getUint16(0) === 0xFFD8) {
                let off = 2;
                while (off < view.byteLength - 2) {
                  const mk = view.getUint16(off); off += 2;
                  if (mk === 0xFFE1) {
                    if (view.getUint32(off + 2) === 0x45786966) {
                      const toff = off + 8;
                      const le = view.getUint16(toff) === 0x4949;
                      const ifd = view.getUint32(toff + 4, le);
                      const tags = view.getUint16(toff + ifd, le);
                      for (let i = 0; i < tags; i++) {
                        const tp = toff + ifd + 2 + i * 12;
                        if (tp + 10 > buf.byteLength) break;
                        if (view.getUint16(tp, le) === 0x0112) {
                          orientation = view.getUint16(tp + 8, le); break;
                        }
                      }
                    }
                    break;
                  } else if ((mk & 0xFF00) !== 0xFF00) break;
                  else off += view.getUint16(off);
                }
              }
            } catch (e) {
              console.warn('EXIF 파싱 실패', e);
            }
          }
        }
        if (cancelled) return;
        if (orientation <= 1) { setDisplaySrc(src); return; }
        
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
        if (cancelled) return;
        const swapped = orientation >= 5 && orientation <= 8;
        const cw = swapped ? img.naturalHeight : img.naturalWidth;
        const ch = swapped ? img.naturalWidth : img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext('2d');
        ctx.save(); ctx.translate(cw / 2, ch / 2);
        const deg = { 3: 180, 6: 90, 8: -90, 5: 90, 7: -90 }[orientation] || 0;
        if (deg) ctx.rotate(deg * Math.PI / 180);
        if ([2, 4, 5, 7].includes(orientation)) ctx.scale(-1, 1);
        const dw = swapped ? ch : cw;
        const dh = swapped ? cw : ch;
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh); ctx.restore();
        if (!cancelled) setDisplaySrc(canvas.toDataURL('image/jpeg', 0.92));
      } catch {
        if (!cancelled) setDisplaySrc(src);
      }
    })();
    return () => { cancelled = true; };
  }, [src]);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const getTouchDist = t => Math.sqrt((t[0].clientX - t[1].clientX) ** 2 + (t[0].clientY - t[1].clientY) ** 2);
    const onStart = e => {
      e.stopPropagation(); // 탭 스와이프 전파 방지
      if (e.touches.length === 2) { e.preventDefault(); st.current.dist = getTouchDist(e.touches); }
      else { st.current.lastXY = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
    };
    const onMove = e => {
      e.stopPropagation(); // 탭 스와이프 전파 방지
      if (e.touches.length === 2) {
        e.preventDefault();
        const d = getTouchDist(e.touches);
        if (st.current.dist) {
          st.current.scale = Math.min(6, Math.max(1, st.current.scale * (d / st.current.dist)));
          setScale(st.current.scale);
        }
        st.current.dist = d;
      } else if (e.touches.length === 1 && st.current.scale > 1.05 && st.current.lastXY) {
        const sdx = e.touches[0].clientX - st.current.lastXY.x;
        const sdy = e.touches[0].clientY - st.current.lastXY.y;
        const R = st.current.rot * Math.PI / 180;
        st.current.pos.x += sdx * Math.cos(R) + sdy * Math.sin(R);
        st.current.pos.y += -sdx * Math.sin(R) + sdy * Math.cos(R);
        setPos({ ...st.current.pos });
        st.current.lastXY = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };
    const onEnd = (e) => {
      e.stopPropagation(); // 탭 스와이프 전파 방지
      st.current.dist = null; st.current.lastXY = null;
      if (st.current.scale < 1.05) {
        st.current.scale = 1; st.current.pos = { x: 0, y: 0 };
        setScale(1); setPos({ x: 0, y: 0 });
      }
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, []);

  const rotate = () => {
    const newRot = (st.current.rot + 90) % 360;
    st.current.rot = newRot; setUserRot(newRot);
    if (onRotate) onRotate(newRot);
    st.current.scale = 1; st.current.pos = { x: 0, y: 0 };
    setScale(1); setPos({ x: 0, y: 0 });
  };

  const swapped = userRot === 90 || userRot === 270;
  return (
    <div style={{ position: 'relative', overflow: 'hidden', height: '100%', backgroundColor: '#000' }}>
      <button onClick={rotate} style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, background: 'rgba(0,0,0,0.5)', border: '1px solid #fff3', borderRadius: 8, padding: '4px 8px', color: '#fff' }}>↻</button>
      <div ref={ref} style={{ height: '100%', overflow: 'hidden', touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src={displaySrc || src} alt={alt} style={{ width: swapped ? 'auto' : '100%', height: swapped ? '70vw' : 'auto', maxWidth: '100%', transform: `rotate(${userRot}deg) scale(${scale}) translate(${pos.x / scale}px,${pos.y / scale}px)`, transition: scale === 1 ? 'transform 0.3s' : 'none', pointerEvents: 'none' }} />
      </div>
    </div>
  );
}
