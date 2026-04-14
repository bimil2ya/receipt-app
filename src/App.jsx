import React, { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { Upload, Download, Trash2, Loader2, FileJson, Plus, Eye, Check, ChevronDown, ChevronRight, Image as ImageIcon } from "lucide-react";

const LOGO_DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wAARCAA0AKADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDvLi+W3ZUJBJOOe1TQ3CTglWBI6gV5942luLvxXFprXFwsXkPMUSQqpYHA6GsTwz4iuLDxQllPNMyy/u2WRycN1U/yqNS2j2GiopRBPkAjB6mip5TI8Y8WTNH4w13DkA3sw/8AHzWLZyMb0HccZBNbXitwfFmu+v22b/0M1iWf/H8v1FT1OmXwn0ZpviazsvDelCWUblsoeASTgIBmiua8E2dvqXh0XdyN0u5Ix32qoH9CKKy5UTdj/G/wq0nWNbur5JLuG4uHMkjLNncT35BFc/8A8Kf02JgyajqAYHIIlHB/75or0/xRGltrTRRDbGEUgHnGRn+ZNYjLgZAUH6V4sajPTcUegfDPRYNJ8M2dpC8jJEh+ZyNzMSST09SaKpfDqdriwkSU5MJVVPsRn+lFbo5JyaZ//9k=";

const CATEGORIES = ["숙박비", "식대", "유류대", "기타"];

// 여러 형식(2026.04-26, 2026.4.26, 26-4-26 등)을 "YYYY-MM-DD"로 정규화
const normalizeDate = (s) => {
  if (!s || typeof s !== "string") return s || "";
  const trimmed = s.trim();
  const parts = trimmed.split(/[-.\/\s]+/).filter(Boolean);
  if (parts.length !== 3) return trimmed;
  let [y, m, d] = parts;
  if (/^\d+$/.test(y) && /^\d+$/.test(m) && /^\d+$/.test(d)) {
    if (y.length === 2) y = "20" + y;
    if (y.length !== 4) return trimmed;
    m = m.padStart(2, "0");
    d = d.padStart(2, "0");
    const mi = Number(m), di = Number(d);
    if (mi < 1 || mi > 12 || di < 1 || di > 31) return trimmed;
    return `${y}-${m}-${d}`;
  }
  return trimmed;
};

const suggestCategory = (merchant = "") => {
  const m = merchant.toLowerCase();
  if (/호텔|모텔|리조트|펜션|게스트하우스|인|inn|hotel|stay|레지던스|콘도/i.test(m)) return "숙박비";
  if (/탕|식당|김밥|분식|치킨|피자|버거|카페|커피|스타벅스|투썸|이디야|빵|제과|레스토랑|한식|중식|일식|양식|횟집|포차|주점|bar|pub|농협|마트|편의점|gs25|cu|seven|이마트|홈플러스/i.test(m)) return "식대";
  if (/주유|gs칼텍스|sk에너지|s-oil|현대오일|에쓰오일|gs주유|오일뱅크|주유소|셀프/i.test(m)) return "유류대";
  return "기타";
};

export default function ReceiptApp() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [lastError, setLastError] = useState(null);
  const [savedFlash, setSavedFlash] = useState({}); // id -> timestamp
  const [openMonthly, setOpenMonthly] = useState(false);
  const [openCategory, setOpenCategory] = useState(false);
  const [toast, setToast] = useState(null); // {type:'info'|'error', msg:string}
  const [modal, setModal] = useState(null); // {type, ...}
  const [userNames, setUserNames] = useState(() => {
    try { return localStorage.getItem("receiptApp_userNames") || "노경호, 김영일"; }
    catch { return "노경호, 김영일"; }
  });
  const [reportDate, setReportDate] = useState("");

  const updateUserNames = (newNames) => {
    setUserNames(newNames);
    try { localStorage.setItem("receiptApp_userNames", newNames); } catch {}
  };

  const formatReportDate = (iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${y}년 ${Number(m)}월 ${Number(d)}일`;
  };

  const headerTitle = `법인카드 영수증 정산 (${userNames}${reportDate ? " - " + formatReportDate(reportDate) : ""})`;

  const showToast = (msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const updateRow = (id, key, val) => {
    setRows(rs => rs.map(r => r.id === id ? { ...r, [key]: val } : r));
    setSavedFlash(s => ({ ...s, [id]: Date.now() }));
    setTimeout(() => {
      setSavedFlash(s => {
        if (s[id] && Date.now() - s[id] >= 1500) {
          const { [id]: _, ...rest } = s;
          return rest;
        }
        return s;
      });
    }, 1600);
  };

  const fileRef = useRef(null);
  const captureRef = useRef(null);
  const categoryCaptureRef = useRef(null);

  const loadHtml2Canvas = () => new Promise((resolve, reject) => {
    if (window.html2canvas) return resolve(window.html2canvas);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = () => resolve(window.html2canvas);
    s.onerror = reject;
    document.head.appendChild(s);
  });

  const captureImage = async () => {
    if (!rows.length) { showToast("캡쳐할 내역이 없습니다", "error"); return; }
    // 용도별 집계 자동 펼침
    const wasOpen = openCategory;
    if (!wasOpen) setOpenCategory(true);
    setCapturing(true);
    await new Promise(r => setTimeout(r, 250));
    try {
      const el = categoryCaptureRef.current;
      if (!el) { showToast("집계 영역을 찾을 수 없습니다", "error"); return; }
      const h2c = await loadHtml2Canvas();
      const canvas = await h2c(el, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
        foreignObjectRendering: false,
      });
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error("이미지 생성 실패")), "image/png");
      });
      setCapturing(false);
      // 파일명 입력 모달 - "이름_저장일" 형태 기본값
      const safeNames = userNames.replace(/[,\/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
      const today = new Date().toISOString().slice(0,10);
      const defaultName = `${safeNames}_${today}`;
      setModal({ type: "captureFilename", blob, defaultName });
    } catch (e) {
      console.error("[캡쳐 실패]", e);
      showToast("캡쳐 실패: " + (e.message || "알 수 없는 오류"), "error");
      setCapturing(false);
    } finally {
      if (!wasOpen) setOpenCategory(wasOpen);
    }
  };

  const doSaveCapture = async (fileName) => {
    if (!modal?.blob) { setModal(null); return; }
    const name = (fileName && fileName.trim()) ? fileName.trim() : modal.defaultName;
    const finalName = name.toLowerCase().endsWith(".png") ? name : name + ".png";
    const { blob } = modal;
    setModal(null);
    try {
      // Web Share API 우선 (iOS 공유 시트)
      try {
        const file = new File([blob], finalName, { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: finalName });
          showToast("공유 완료");
          return;
        }
      } catch (e) {
        if (e.name === "AbortError") return;
      }
      // 폴백: 다운로드
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = finalName;
      a.target = "_self";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch {}
      }, 1000);
      showToast(`${finalName} 저장됨`);
    } catch (e) {
      showToast("저장 실패: " + e.message, "error");
    }
  };

  // 이미지 파일을 항상 JPEG로 변환 + 크기 축소하여 base64 반환
  // (HEIC/HEIF 포맷, 대용량 파일, iOS Safari 호환성 문제 해결)
  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      if (!file) return reject(new Error("파일이 없습니다"));

      const reader = new FileReader();
      reader.onerror = () => reject(new Error("파일 읽기 실패"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("이미지 디코딩 실패 (HEIC 등 지원되지 않는 포맷일 수 있음)"));
        img.onload = () => {
          try {
            // 최대 긴 변 2048px로 축소 (영수증 글자 가독성 유지)
            const MAX_DIM = 2048;
            let { width, height } = img;
            if (width > MAX_DIM || height > MAX_DIM) {
              const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
              width = Math.round(width * ratio);
              height = Math.round(height * ratio);
            }
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            // 흰 배경으로 칠해서 투명 배경 방지
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            // 항상 JPEG로 통일 (HEIC 등 호환성 문제 해결)
            const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
            resolve({
              data: dataUrl.split(",")[1],
              dataUrl,
              type: "image/jpeg",
            });
          } catch (e) {
            reject(new Error("이미지 변환 실패: " + e.message));
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });const extract = async (file) => {
    const { data, dataUrl, type } = await fileToBase64(file);
    const mediaType = type && type.startsWith("image/") ? type : "image/jpeg";
    const prompt = `이 이미지에는 하나 또는 여러 개의 한국 영수증이 있을 수 있습니다. 이미지에 보이는 각 영수증마다 아래 필드를 뽑아 JSON 배열 하나로만 출력하세요. 설명/코드펜스/머리말 금지.

[
  {"date":"YYYY-MM-DD","merchant":"가맹점명","biznum":"사업자등록번호","supply":0,"vat":0,"total":0,"items":"주요 품목","unreadable":false},
  ...
]

규칙:
- 영수증이 1개면 배열에 1개, 여러 개면 모두 배열에 담을 것
- 영수증이지만 너무 흐리거나 손상되어 금액/날짜 등 핵심 정보를 읽을 수 없으면 "unreadable": true로 표시하고 읽을 수 있는 필드만 채울 것
- 영수증이 아니거나 전혀 아무것도 인식할 수 없으면 빈 배열 [] 반환
- 금액은 반드시 숫자 타입(콤마/원 제거)
- 찾을 수 없는 필드는 빈 문자열 또는 0`;
    let apiErr = null;
    let rawText = "";
    let parsedArr = [];
    try {
      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data } },
              { type: "text", text: prompt },
            ],
          }],
        }),
      });
      const j = await resp.json();
      if (j.error) { apiErr = j.error.message || "API 오류"; }
      rawText = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
      let cleaned = rawText.replace(/```(?:json)?/gi, "").trim();
      // 본문에서 JSON 배열 추출
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) cleaned = match[0];
      const parsed = JSON.parse(cleaned);
      parsedArr = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      apiErr = apiErr || ("추출 실패: " + e.message);
      console.error("[영수증 추출 실패]", file.name, e, "raw:", rawText);
    }

    // API 자체가 실패한 경우 → 행 생성 안 함, 실패 건수만 보고
    if (apiErr) {
      return { rows: [], failed: 1 };
    }

    // 아무것도 인식 못한 경우 → 행 생성 안 함
    if (parsedArr.length === 0) {
      return { rows: [], failed: 1 };
    }

    // 각 영수증마다 행 생성 (unreadable 플래그 있어도 읽을 수 있는 정보는 살림)
    const rows = parsedArr.map(p => ({
      id: crypto.randomUUID(),
      imageUrl: dataUrl,
      sourceFile: file.name,
      date: normalizeDate(p.date || ""),
      merchant: p.merchant || "",
      biznum: p.biznum || "",
      supply: Number(p.supply) || 0,
      vat: Number(p.vat) || 0,
      total: Number(p.total) || 0,
      items: p.items || "",
      category: suggestCategory(p.merchant || ""),
      note: "",
    }));
    // unreadable 플래그가 있는 항목 중 아무 정보도 없는 건 제외
    const filteredRows = rows.filter((r, i) => {
      const p = parsedArr[i];
      if (p.unreadable && !r.date && !r.merchant && !r.total) return false;
      return true;
    });
    const failed = rows.length - filteredRows.length;
    return { rows: filteredRows, failed };
  };

  const handleFiles = async (files) => {
    if (!files || !files.length) return;
    setLoading(true);
    setLastError(null);
    const newRows = [];
    let failedCount = 0;
    for (const f of files) {
      try {
        const { rows: rowsFromFile, failed } = await extract(f);
        newRows.push(...rowsFromFile);
        failedCount += failed;
      } catch (e) {
        console.error("[업로드 예외]", f.name, e);
        failedCount++;
      }
    }
    setRows(r => [...r, ...newRows]);
    setLoading(false);
    if (failedCount > 0) {
      setLastError(`인식불가 ${failedCount}건, 다시 업로드해주세요`);
    }
  };

  const addBlank = () => setRows(rs => [...rs, {
    id: crypto.randomUUID(), imageUrl: "", date: "", merchant: "", biznum: "",
    supply: 0, vat: 0, total: 0, items: "", category: "기타", note: "",
  }]);
  const delRow = (id) => setRows(rs => rs.filter(r => r.id !== id));

  const exportRows = () => rows.map(({ imageUrl, id, sourceFile, ...r }) => r);

  // iOS/모바일 안정 저장: Web Share API 우선, 실패 시 다운로드 폴백
  const saveBlob = async (blob, fileName, shareTitle) => {
    let shared = false;
    try {
      const file = new File([blob], fileName, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: shareTitle || fileName });
          shared = true;
          showToast(`${fileName} 공유 완료`);
          return;
        } catch (e) {
          if (e.name === "AbortError") { shared = true; return; }
          console.warn("share 실패, 다운로드 폴백", e);
        }
      }
    } catch (e) {
      console.warn("canShare 체크 실패", e);
    }
    if (shared) return;
    // 폴백: 다운로드
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.target = "_self";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch {}
      }, 1000);
      showToast(`${fileName} 다운로드됨`);
    } catch (e) {
      showToast("저장 실패: " + e.message, "error");
    }
  };

  const downloadCSV = async () => {
    try {
      const data = exportRows();
      if (!data.length) { showToast("내보낼 내역이 없습니다", "error"); return; }
      const headers = Object.keys(data[0]);
      const csv = [headers.join(","), ...data.map(r => headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      await saveBlob(blob, `법인카드_정산_${new Date().toISOString().slice(0, 10)}.csv`, "법인카드 정산 CSV");
    } catch (e) {
      showToast("CSV 저장 실패: " + e.message, "error");
    }
  };

  const downloadXLSX = async () => {
    try {
      const data = exportRows();
      if (!data.length) { showToast("내보낼 내역이 없습니다", "error"); return; }
      const ws = XLSX.utils.json_to_sheet(data, {
        header: ["date", "merchant", "biznum", "supply", "vat", "total", "category", "items", "note"],
      });
      ws["!cols"] = [{wch:12},{wch:20},{wch:14},{wch:10},{wch:10},{wch:10},{wch:10},{wch:24},{wch:16}];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "정산");
      // 파일 직접 쓰기 대신 블롭 생성 후 공통 저장 함수 사용
      const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      await saveBlob(blob, `법인카드_정산_${new Date().toISOString().slice(0, 10)}.xlsx`, "법인카드 정산 엑셀");
    } catch (e) {
      showToast("XLSX 저장 실패: " + e.message, "error");
    }
  };

  const STORAGE_PREFIX = "receiptApp_savedWork_";

  const saveWork = () => {
    if (!rows.length) { showToast("저장할 내역이 없습니다", "error"); return; }
    setModal({
      type: "save",
      defaultName: `정산_${new Date().toISOString().slice(0,10).replace(/-/g,"")}`,
      location: "browser",
    });
  };

  const doSaveWork = async (name, location) => {
    if (!name || !name.trim()) { setModal(null); return; }
    const trimmed = name.trim();
    const payload = { savedAt: new Date().toISOString(), rowCount: rows.length, rows };
    if (location === "file") {
      // 기기에 JSON 파일로 저장 (iCloud Drive 등)
      setModal(null);
      try {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        await saveBlob(blob, `${trimmed}.json`, "법인카드 정산 데이터");
      } catch (e) {
        showToast("파일 저장 실패: " + e.message, "error");
      }
    } else {
      // 브라우저 내부 저장
      try {
        localStorage.setItem(STORAGE_PREFIX + trimmed, JSON.stringify(payload));
        setModal(null);
        showToast(`"${trimmed}" 앱 내부에 저장됨 (${rows.length}건)`);
      } catch (e) {
        setModal(null);
        showToast("저장 실패: " + e.message, "error");
      }
    }
  };

  const getSavedList = () => {
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(STORAGE_PREFIX));
      return keys.map(k => {
        try {
          const data = JSON.parse(localStorage.getItem(k));
          return { key: k, name: k.slice(STORAGE_PREFIX.length), savedAt: data.savedAt, rowCount: data.rowCount };
        } catch { return null; }
      }).filter(Boolean).sort((a,b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
    } catch (e) {
      return [];
    }
  };

  const loadWork = () => {
    const items = getSavedList();
    setModal({ type: "load", items });
  };const loadFromFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const rowsArr = Array.isArray(data) ? data : (data.rows || []);
        const migrated = rowsArr.map(r => ({
          ...r,
          category: CATEGORIES.includes(r.category) ? r.category : "기타",
        }));
        setRows(migrated);
        setModal(null);
        showToast(`파일에서 ${migrated.length}건 불러옴`);
      } catch (err) {
        showToast("파일 읽기 실패: " + err.message, "error");
      }
    };
    reader.readAsText(f);
    e.target.value = ""; // 같은 파일 재선택 가능하도록
  };

  const doLoadWork = (item) => {
    try {
      const data = JSON.parse(localStorage.getItem(item.key));
      const migrated = (data.rows || []).map(r => ({
        ...r,
        category: CATEGORIES.includes(r.category) ? r.category : "기타",
      }));
      setRows(migrated);
      setModal(null);
      showToast(`"${item.name}" 불러옴 (${migrated.length}건)`);
    } catch (e) {
      showToast("불러오기 실패: " + e.message, "error");
    }
  };

  const doDeleteWork = (item) => {
    try {
      localStorage.removeItem(item.key);
      setModal({ type: "load", items: getSavedList() });
      showToast(`"${item.name}" 삭제됨`);
    } catch (e) {
      showToast("삭제 실패: " + e.message, "error");
    }
  };

  const fmt = (n) => Number(n || 0).toLocaleString("ko-KR");

  // 합계: 월별(월→용도별), 용도별(용도→일자별), 각 그룹별 건수 포함
  const monthlyGrouped = {};
  const categoryGrouped = {};
  let grand = 0;
  rows.forEach(r => {
    const amt = Number(r.total) || 0;
    const m = (r.date || "").slice(0, 7) || "미상";
    const d = r.date || "미상";
    const c = r.category || "기타";
    const note = (r.note || "").trim();
    if (!monthlyGrouped[m]) monthlyGrouped[m] = { total: 0, count: 0, byCat: {} };
    monthlyGrouped[m].total += amt;
    monthlyGrouped[m].count += 1;
    if (!monthlyGrouped[m].byCat[c]) monthlyGrouped[m].byCat[c] = { amt: 0, cnt: 0, notes: [] };
    monthlyGrouped[m].byCat[c].amt += amt;
    monthlyGrouped[m].byCat[c].cnt += 1;
    if (note) monthlyGrouped[m].byCat[c].notes.push(note);
    if (!categoryGrouped[c]) categoryGrouped[c] = { total: 0, count: 0, byDate: {} };
    categoryGrouped[c].total += amt;
    categoryGrouped[c].count += 1;
    if (!categoryGrouped[c].byDate[d]) categoryGrouped[c].byDate[d] = { amt: 0, cnt: 0, notes: [] };
    categoryGrouped[c].byDate[d].amt += amt;
    categoryGrouped[c].byDate[d].cnt += 1;
    if (note) categoryGrouped[c].byDate[d].notes.push(note);
    grand += amt;
  });

  const selected = rows.find(r => r.id === selectedId);

  return (
    <div className="min-h-screen bg-slate-50 p-2 sm:p-4 font-sans">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-2 mb-2 pb-2 flex-wrap">
          <img src={LOGO_DATA_URL} alt="(주)미래생태공간" className="h-5 sm:h-7 object-contain"/>
          <h1 className="text-sm sm:text-xl font-bold flex-1 min-w-0 break-keep">{headerTitle}</h1>
          <div className="flex gap-1 ml-auto">
            <button onClick={()=>setModal({type:"date"})} className="flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs whitespace-nowrap" title="날짜 설정">
              📅 <span className="hidden sm:inline">날짜</span>
            </button>
            <button onClick={()=>setModal({type:"names", current: userNames})} className="flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs whitespace-nowrap" title="이름 변경">
              👤 <span className="hidden sm:inline">이름</span>
            </button>
          </div>
        </div>
        <p className="hidden sm:block text-xs text-slate-500 mb-3">영수증 사진을 올리면 자동으로 항목을 추출해 표로 정리합니다. 값을 수정하면 해당 행이 초록색으로 잠시 반짝이며 자동 저장됩니다. "이미지 캡쳐" 버튼으로 전체 내역을 PNG로 저장할 수 있습니다.</p>

        {/* 상단 집계 */}
        {rows.length > 0 && (
          <div className="bg-slate-900 text-white rounded-lg p-3 sm:p-4 mb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs text-slate-300">총 합계 ({rows.length}건)</div>
                <div className="text-2xl sm:text-3xl font-bold mt-1">{fmt(grand)}원</div>
              </div>
              <div className="flex flex-col sm:flex-row gap-1 sm:gap-2">
                <button onClick={()=>setOpenCategory(v=>!v)} className="flex items-center gap-1 px-2 py-1.5 bg-slate-700 rounded hover:bg-slate-600 text-xs sm:text-sm whitespace-nowrap">
                  {openCategory ? <ChevronDown size={12}/> : <ChevronRight size={12}/>} 용도별
                </button>
                <button onClick={()=>setOpenMonthly(v=>!v)} className="flex items-center gap-1 px-2 py-1.5 bg-slate-700 rounded hover:bg-slate-600 text-xs sm:text-sm whitespace-nowrap">
                  {openMonthly ? <ChevronDown size={12}/> : <ChevronRight size={12}/>} 일자별
                </button>
              </div>
            </div>

            {openCategory && (() => {
              // 일비 = 숙박비 + 식대 + 기타
              const DAILY_CATS = ["숙박비", "식대", "기타"];
              let dailyTotal = 0, dailyCount = 0;
              DAILY_CATS.forEach(c => {
                if (categoryGrouped[c]) {
                  dailyTotal += categoryGrouped[c].total;
                  dailyCount += categoryGrouped[c].count;
                }
              });
              const fuel = categoryGrouped["유류대"];
              const renderCategoryBlock = (c) => {
                const g = categoryGrouped[c];
                if (!g) return null;
                const dates = Object.entries(g.byDate).sort();
                return (
                  <React.Fragment key={c}>
                    {dates.map(([d,v],i) => (
                      <tr key={c+d} className={i===0?"border-t":""}>
                        <td className="py-1 font-medium">{i===0?c:""}</td>
                        <td className="py-1 text-slate-600">
                          {d}
                          {v.notes.length > 0 && <span className="ml-2 text-[10px] text-slate-400">({v.notes.join(", ")})</span>}
                        </td>
                        <td className="py-1 text-right text-slate-500">{v.cnt}건</td>
                        <td className="py-1 text-right">{fmt(v.amt)}원</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50">
                      <td className="py-1" colSpan={2}><span className="text-xs text-slate-500">└ {c} 소계</span></td>
                      <td className="py-1 text-right text-xs text-slate-500">{g.count}건</td>
                      <td className="py-1 text-right font-semibold">{fmt(g.total)}원</td>
                    </tr>
                  </React.Fragment>
                );
              };
              return (
              <div ref={categoryCaptureRef} className="mt-3 bg-white text-slate-800 rounded p-3">
                {/* 캡쳐용 제목 헤더 (평소엔 숨김, 캡쳐 시에만 보임) */}
                <div className={`${capturing ? "flex" : "hidden"} items-center gap-3 mb-3 pb-3 border-b`}>
                  <img src={LOGO_DATA_URL} alt="" className="h-9 object-contain flex-shrink-0"/>
                  <h2 className="text-xs sm:text-sm font-bold whitespace-nowrap">{headerTitle}</h2>
                </div>
                <div className="flex items-baseline justify-between mb-2">
                  <h4 className="font-semibold text-sm">용도별 합계 · 일자별 세부</h4>
                  <span className="text-sm text-slate-600">{rows.length}건 · <b>{fmt(grand)}원</b></span>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-slate-500 text-xs">
                    <tr><th className="text-left py-1">용도</th><th className="text-left py-1">일자</th><th className="text-right py-1">건수</th><th className="text-right py-1">금액</th></tr>
                  </thead>
                  <tbody>
                    {/* 일비 그룹: 숙박비 → 식대 → 기타 */}
                    {DAILY_CATS.map(c => renderCategoryBlock(c))}
                    {dailyCount > 0 && (
                      <tr className="bg-indigo-50 border-t-2 border-indigo-200">
                        <td className="py-2 font-bold text-indigo-700" colSpan={2}>■ 일비 합계 <span className="text-xs font-normal text-slate-500">(숙박비+식대+기타)</span></td>
                        <td className="py-2 text-right text-indigo-700 font-semibold">{dailyCount}건</td>
                        <td className="py-2 text-right text-indigo-700 font-bold">{fmt(dailyTotal)}원</td>
                      </tr>
                    )}
                    {/* 구분선 */}
                    {fuel && (
                      <tr><td colSpan={4} className="py-2"><div className="border-t-2 border-dashed border-slate-300"></div></td></tr>
                    )}
                    {/* 유류대 */}
                    {renderCategoryBlock("유류대")}
                  </tbody>
                </table>
              </div>
              );
            })()}

            {openMonthly && (
              <div className="mt-3 bg-white text-slate-800 rounded p-3">
                <div className="flex items-baseline justify-between mb-2">
                  <h4 className="font-semibold text-sm">일자별 합계 · 용도별 세부</h4>
                  <span className="text-sm text-slate-600">{rows.length}건 · <b>{fmt(grand)}원</b></span>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-slate-500 text-xs">
                    <tr><th className="text-left py-1">월</th><th className="text-left py-1">용도</th><th className="text-right py-1">건수</th><th className="text-right py-1">금액</th></tr>
                  </thead>
                  <tbody>
                    {Object.keys(monthlyGrouped).sort().map(m => {
                      const cats = Object.entries(monthlyGrouped[m].byCat);
                      return (
                        <React.Fragment key={m}>
                          {cats.map(([c,v],i) => (
                            <tr key={m+c} className={i===0?"border-t":""}>
                              <td className="py-1 font-medium">{i===0?m:""}</td>
                              <td className="py-1 text-sla<div className="grid grid-cols-3 gap-2 mb-2">
          <button onClick={() => fileRef.current?.click()} className="flex items-center justify-center gap-1 px-2 py-2 bg-slate-900 text-white rounded-lg text-xs sm:text-sm hover:bg-slate-700">
            <Upload size={14}/> 사진 업로드
          </button>
          <button onClick={addBlank} className="flex items-center justify-center gap-1 px-2 py-2 bg-slate-900 text-white rounded-lg text-xs sm:text-sm hover:bg-slate-700">
            <Plus size={14}/> 빈 행 추가
          </button>
          <button onClick={captureImage} disabled={!rows.length || capturing} className="flex items-center justify-center gap-1 px-2 py-2 bg-rose-600 text-white rounded-lg text-xs sm:text-sm hover:bg-rose-500 disabled:opacity-40">
            {capturing ? <Loader2 size={14} className="animate-spin"/> : <ImageIcon size={14}/>} 이미지 캡쳐
          </button>
          <input ref={fileRef} type="file" accept="image/*,.heic,.heif,.jpg,.jpeg,.png,.webp,.pdf" multiple className="hidden" onChange={e => handleFiles(Array.from(e.target.files || []))}/>
        </div>
        <div className="flex flex-nowrap gap-1 md:gap-2 mb-4 overflow-x-auto">
          <button onClick={downloadCSV} disabled={!rows.length} className="flex items-center gap-1 px-2 py-1.5 bg-emerald-600 text-white rounded-lg text-xs hover:bg-emerald-500 disabled:opacity-40 whitespace-nowrap">
            <Download size={12}/> CSV
          </button>
          <button onClick={downloadXLSX} disabled={!rows.length} className="flex items-center gap-1 px-2 py-1.5 bg-emerald-600 text-white rounded-lg text-xs hover:bg-emerald-500 disabled:opacity-40 whitespace-nowrap">
            <Download size={12}/> XLSX
          </button>
          <button onClick={saveWork} disabled={!rows.length} className="flex items-center gap-1 px-2 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-500 disabled:opacity-40 whitespace-nowrap">
            <FileJson size={12}/> 작업 저장
          </button>
          <button onClick={loadWork} className="flex items-center gap-1 px-2 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-500 whitespace-nowrap">
            <FileJson size={12}/> 작업 불러오기
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-600 mb-3">
            <Loader2 className="animate-spin" size={16}/> 영수증을 분석 중입니다...
          </div>
        )}

        {lastError && (
          <div className="mb-3 p-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-900 flex items-center justify-between gap-2">
            <span>⚠️ {lastError}</span>
            <button onClick={()=>setLastError(null)} className="text-amber-700 hover:text-amber-900 text-lg leading-none">✕</button>
          </div>
        )}

        <div ref={captureRef} className="bg-slate-50 p-3 rounded-lg">
          {/* 캡쳐용 헤더 (제출용) */}
          <div className="flex items-center gap-3 mb-3 pb-2 border-b">
            <h2 className="text-lg font-bold flex-1">사용한 영수증 내역</h2>
            <div className="text-right">
              <div className="text-xs text-slate-500">등록 건수 / 총 합계</div>
              <div className="text-base font-bold text-indigo-600">{rows.length}건 · {fmt(grand)}원</div>
            </div>
          </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-3">
          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="p-2 w-10"></th>
                  <th className="p-2 text-center">날짜</th>
                  <th className="p-2 text-center">용도</th>
                  <th className="p-2 text-center">가맹점</th>
                  <th className="p-2 text-center">합계</th>
                  <th className="p-2 text-center">비고</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const flashing = !!savedFlash[r.id];
                  const rowBg = flashing ? "bg-emerald-100" : (selectedId===r.id ? "bg-indigo-50" : "");
                  return (
                  <tr key={r.id} className={`border-t transition-colors duration-300 ${rowBg}`}>
                    <td className="p-1 text-center">
                      <button onClick={()=>setSelectedId(r.id)} title="원본 영수증 보기" className={`p-1 rounded hover:bg-slate-200 ${selectedId===r.id?"text-indigo-600":"text-slate-400"}`}>
                        <Eye size={16}/>
                      </button>
                    </td>
                    <td className="p-1"><input className="w-28 px-1 py-0.5 border rounded" value={r.date} onChange={e=>updateRow(r.id,"date",e.target.value)} onBlur={e=>updateRow(r.id,"date",normalizeDate(e.target.value))} onFocus={()=>setSelectedId(r.id)}/></td>
                    <td className="p-1">
                      <select className="px-1 py-0.5 border rounded" value={r.category} onChange={e=>updateRow(r.id,"category",e.target.value)} onFocus={()=>setSelectedId(r.id)}>
                        {CATEGORIES.map(c=><option key={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="p-1"><input className="w-44 px-1 py-0.5 border rounded" value={r.merchant} onChange={e=>updateRow(r.id,"merchant",e.target.value)} onFocus={()=>setSelectedId(r.id)}/></td>
                    <td className="p-1"><input
                      type="text"
                      inputMode="numeric"
                      className="w-28 px-1 py-0.5 border rounded text-right font-semibold"
                      value={Number(r.total || 0).toLocaleString("ko-KR")}
                      onChange={e=>updateRow(r.id,"total",Number(e.target.value.replace(/[^0-9]/g,""))||0)}
                      onFocus={()=>setSelectedId(r.id)}
                    /></td>
                    <td className="p-1"><input className="w-40 px-1 py-0.5 border rounded" value={r.note} onChange={e=>updateRow(r.id,"note",e.target.value)} onFocus={()=>setSelectedId(r.id)}/></td>
                    <td className="p-1"><button onClick={()=>delRow(r.id)} className="text-red-500 hover:text-red-700"><Trash2 size={14}/></button></td>
                  </tr>
                  );
                })}
                {!rows.length && (
                  <tr><td colSpan={7} className="p-8 text-center text-slate-400">"사진 업로드" 또는 "카메라 촬영" 버튼으로 영수증을 올리면 자동으로 표가 채워집니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-lg border p-3" data-html2canvas-ignore="true">
            <h3 className="font-semibold text-sm mb-2">원본 영수증 미리보기</h3>
            {selected?.imageUrl ? (
              <img src={selected.imageUrl} alt="receipt" className="w-full rounded border"/>
            ) : (
              <div className="text-xs text-slate-400 py-8 text-center">행을 클릭하면 원본 이미지가 여기에 표시됩니다.</div>
            )}
            {selected && (
              <div className="mt-3 text-xs space-y-1 text-slate-600">
                <div><b>품목:</b> {selected.items || "-"}</div>
                <div><b>추천 용도:</b> {suggestCategory(selected.merchant)}</div>
              </div>
            )}
          </div>
        </div>

      </div>
        </div>

        {/* 날짜 설정 모달 */}
        {modal?.type === "date" && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={()=>setModal(null)}>
            <div className="bg-white rounded-lg p-4 w-full max-w-sm" onClick={e=>e.stopPropagation()}>
              <h3 className="font-bold mb-3">📅 날짜 설정</h3>
              <p className="text-xs text-slate-500 mb-2">제목에 표시될 날짜를 선택하세요.</p>
              <input
                type="date"
                autoFocus
                defaultValue={reportDate || new Date().toISOString().slice(0,10)}
                id="date-input"
                className="w-full px-3 py-2 border rounded mb-4 text-base"
              />
              <div className="flex gap-2 justify-between">
                <button onClick={()=>{ setReportDate(""); setModal(null); showToast("날짜 제거됨"); }} className="px-3 py-2 text-sm rounded border text-red-600">날짜 제거</button>
                <div className="flex gap-2">
                  <button onClick={()=>setModal(null)} className="px-3 py-2 text-sm rounded border">취소</button>
                  <button onClick={()=>{
                    const v = document.getElementById("date-input").value;
                    setReportDate(v);
                    setModal(null);
                    if (v) showToast(`날짜: ${formatReportDate(v)}`);
                  }} className="px-3 py-2 text-sm rounded bg-indigo-600 text-white">적용</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 이름 변경 모달 */}
        {modal?.type === "names" && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={()=>setModal(null)}>
            <div className="bg-white rounded-lg p-4 w-full max-w-sm" onClick={e=>e.stopPropagation()}>
              <h3 className="font-bold mb-3">👤 이름 변경</h3>
              <p className="text-xs text-slate-500 mb-2">여러 명일 경우 쉼표(,)로 구분하세요. 예: 노경호, 김영일</p>
              <input
                autoFocus
                defaultValue={modal.current}
                id="names-input"
                className="w-full px-3 py-2 border rounded mb-4"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={()=>setModal(null)} className="px-3 py-2 text-sm rounded border">취소</button>
                <button onClick={()=>{
                  const v = document.getElementById("names-input").value.trim();
                  if (!v) { showToast("이름을 입력하세요", "error"); return; }
                  updateUserNames(v);
                  setModal(null);
                  showToast("이름 변경됨");
                }} className="px-3 py-2 text-sm rounded bg-indigo-600 text-white">적용</button>
              </div>
            </div>
          </div>
        )}

        {/* 토스트 */}
        {toast && (
          <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg text-sm z-50 ${toast.type==="error"?"bg-red-600 text-white":"bg-slate-900 text-white"}`}>
            {toast.msg}
          </div>
        )}

        {/* 작업 저장 모달 */}
        {modal?.type === "save" && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={()=>setModal(null)}>
            <div className="bg-white rounded-lg p-4 w-full max-w-sm" onClick={e=>e.stopPropagation()}>
              <h3 className="font-bold mb-3">작업 저장</h3>
              <label className="block text-xs text-slate-600 mb-1">저장할 이름</label>
              <input autoFocus defaultValue={modal.defaultName} id="save-name-input" className="w-full px-3 py-2 border rounded mb-3"/>
              <label className="block text-xs text-slate-600 mb-1">저장 위치</label>
              <div className="space-y-2 mb-4">
                <label className="flex items-start gap-2 p-2 border rounded cursor-pointer hover:bg-slate-50">
                  <input type="radio" name="save-loc" value="browser" defaultChecked className="mt-1"/>
                  <div className="text-sm">
                    <div className="font-medium">앱 내부 저장</div>
                    <div className="text-xs text-slate-500">이 브라우저에 저장. "작업 불러오기"로 복원 가능 (빠름, 같은 기기에서만)</div>
                  </div>
                </label>
                <label className="flex items-start gap-2 p-2 border rounded cursor-pointer hover:bg-slate-50">
                  <input type="radio" name="save-loc" value="file" className="mt-1"/>
                  <div className="text-sm">
                    <div className="font-medium">파일로 저장</div>
                    <div className="text-xs text-slate-500">JSON 파일로 저장. 저장 위치(사진/파일/iCloud Drive 등) 선택 가능</div>
                  </div>
                </label>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={()=>setModal(null)} className="px-3 py-2 text-sm rounded border">취소</button>
                <button onClick={()=>{
                  const name = document.getElementById("save-name-input").value;
                  const loc = document.querySelector('input[name="save-loc"]:checked')?.value || "browser";
                  doSaveWork(name, loc);
                }} className="px-3 py-2 text-sm rounded bg-indigo-600 text-white">저장</button>
              </div>
            </div>
          </div>
        )}

        {/* 작업 불러오기 모달 */}
        {modal?.type === "load" && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={()=>setModal(null)}>
            <div className="bg-white rounded-lg p-4 w-full max-w-md max-h-[80vh] overflow-auto" onClick={e=>e.stopPropagation()}>
              <h3 className="font-bold mb-3">작업 불러오기</h3>
              <label className="flex items-center justify-center gap-2 p-3 mb-3 border-2 border-dashed border-indigo-300 rounded cursor-pointer hover:bg-indigo-50 text-sm text-indigo-700">
                📁 JSON 파일에서 불러오기 (iCloud Drive, 파일 앱 등)
                <input type="file" accept="application/json,.json" className="hidden" onChange={loadFromFile}/>
              </label>
              <div className="text-xs text-slate-500 mb-2">— 또는 앱 내부에 저장된 작업 —</div>
              {modal.items.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">앱 내부에 저장된 작업이 없습니다.</p>
              ) : (
                <ul className="space-y-2">
                  {modal.items.map(it => (
                    <li key={it.key} className="flex items-center gap-2 p-2 border rounded">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{it.name}</div>
                        <div className="text-xs text-slate-500">{it.rowCount}건 · {(it.savedAt||"").slice(0,16).replace("T"," ")}</div>
                      </div>
                      <button onClick={()=>doLoadWork(it)} className="px-2 py-1 text-xs rounded bg-indigo-600 text-white">불러오기</button>
                      <button onClick={()=>doDeleteWork(it)} className="px-2 py-1 text-xs rounded bg-red-500 text-white">삭제</button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex justify-end mt-4">
                <button onClick={()=>setModal(null)} className="px-3 py-2 text-sm rounded border">닫기</button>
              </div>
            </div>
          </div>
        )}

        {/* 이미지 캡쳐 파일명 입력 모달 */}
        {modal?.type === "captureFilename" && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={()=>setModal(null)}>
            <div className="bg-white rounded-lg p-4 w-full max-w-sm" onClick={e=>e.stopPropagation()}>
              <h3 className="font-bold mb-3">이미지 저장</h3>
              <label className="block text-xs text-slate-600 mb-1">파일 이름</label>
              <input
                autoFocus
                defaultValue={modal.defaultName}
                id="capture-name-input"
                className="w-full px-3 py-2 border rounded mb-1"
                onKeyDown={e => { if (e.key === "Enter") doSaveCapture(document.getElementById("capture-name-input").value); }}
              />
              <p className="text-xs text-slate-400 mb-4">.png 확장자는 자동으로 붙습니다.</p>
              <div className="flex gap-2 justify-end">
                <button onClick={()=>setModal(null)} className="px-3 py-2 text-sm rounded border">취소</button>
                <button onClick={()=>doSaveCapture(document.getElementById("capture-name-input").value)} className="px-3 py-2 text-sm rounded bg-rose-600 text-white">저장</button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
