import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { helpCategories, helpIntro, helpShortcuts, helpQuestionMatches, normalizeHelpQuery } from './helpFaqData';

export default function SettingsHelpModal({
  show,
  onClose,
}) {
  const [query, setQuery] = useState('');
  const [openCategoryId, setOpenCategoryId] = useState('capture');
  const [openQuestionId, setOpenQuestionId] = useState('');
  const searchRef = useRef(null);

  useEffect(() => {
    if (!show) return;
    setQuery('');
    setOpenCategoryId('capture');
    setOpenQuestionId('');
    requestAnimationFrame(() => searchRef.current?.focus?.());
  }, [show]);

  const normalizedQuery = normalizeHelpQuery(query);

  const filteredCategories = useMemo(() => helpCategories
    .map(category => ({
      ...category,
      questions: category.questions.filter(question => helpQuestionMatches(normalizedQuery, question)),
    }))
    .filter(category => category.questions.length > 0), [normalizedQuery]);

  const introVisible = !normalizedQuery;
  const resultCount = filteredCategories.reduce((count, category) => count + category.questions.length, 0);
  const handleShortcut = (shortcut) => {
    setQuery('');
    if (shortcut.target.type === 'intro') {
      setOpenCategoryId('');
      setOpenQuestionId(helpIntro.id);
      document.getElementById('help-intro')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setOpenCategoryId(shortcut.target.categoryId);
    setOpenQuestionId(shortcut.target.questionId);
    requestAnimationFrame(() => {
      document.getElementById(`help-category-${shortcut.target.categoryId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-950 text-slate-100"
      style={{ paddingTop: 'max(20px, env(safe-area-inset-top))', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col">
        <header className="shrink-0 border-b border-slate-800 px-4 py-4">
          <div className="flex items-start gap-3">
            <button
              onClick={onClose}
              className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 active:scale-95"
              aria-label="뒤로"
            >
              <ArrowLeft size={22} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-amber-300">도움말</p>
              <h2 className="mt-1 text-[1.9rem] font-black tracking-[-0.02em] text-white">
                자주 묻는 질문
              </h2>
            </div>
            <button
              onClick={onClose}
              className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 active:scale-95"
              aria-label="닫기"
            >
              <X size={22} />
            </button>
          </div>
        </header>

        <div className="shrink-0 px-4 pt-1">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
            <label className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3">
              <Search size={20} className="shrink-0 text-slate-400" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="예: 사진, 금액, 카톡"
                autoComplete="off"
                inputMode="search"
                className="min-w-0 flex-1 bg-transparent text-[1.05rem] font-bold text-white outline-none placeholder:text-slate-500"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 active:text-slate-200"
                  aria-label="검색어 지우기"
                >
                  <X size={18} />
                </button>
              )}
            </label>
          </div>
        </div>

        <main className="flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {introVisible ? (
            <>
              <section id="help-intro" className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-amber-200">바로 시작</p>
                    <h3 className="mt-1 whitespace-nowrap text-[1.35rem] font-black tracking-[-0.02em] text-white sm:text-[1.45rem]">
                      {helpIntro.title}
                    </h3>
                  </div>
                  <span className="rounded-full border border-amber-400/30 bg-amber-300/10 px-3 py-1 text-xs font-black text-amber-100 whitespace-nowrap">
                    처음 보는 분
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  {helpIntro.answer.map((line, index) => (
                    <div key={line} className="flex gap-3">
                      <span className="mt-0.5 w-8 shrink-0 text-center text-[1.15rem] font-black text-amber-200">
                        {String.fromCharCode(9312 + index)}
                      </span>
                      <p className="min-w-0 flex-1 text-[1.1rem] leading-7 text-slate-100">
                        {line}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
                <p className="text-sm font-black text-slate-400">자주 찾는 질문</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {helpShortcuts.map(shortcut => (
                    <button
                      key={shortcut.label}
                      onClick={() => handleShortcut(shortcut)}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-700 bg-slate-950/50 px-4 py-4 text-left active:scale-[0.99]"
                    >
                      <span className="min-w-0 flex-1 whitespace-nowrap text-[1.02rem] font-black leading-6 text-white">
                        {shortcut.label}
                      </span>
                      <ChevronDown size={18} className="shrink-0 text-amber-300" />
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {normalizedQuery && (
            <div className="mt-2 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <div className="flex items-center gap-2">
                <p className="text-[1rem] font-black text-white">검색 결과</p>
                <p className="text-[1.05rem] font-black text-amber-300">
                  {resultCount}개
                </p>
              </div>
              <p className="mt-1 text-[0.95rem] leading-6 text-slate-400">
                검색어를 지우면 전체 목록이 다시 보입니다.
              </p>
            </div>
          )}

          <div className="mt-2 space-y-3">
            {normalizedQuery && filteredCategories.length === 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-4">
                <p className="text-[1.05rem] font-black text-white">찾는 내용이 없어요.</p>
                <p className="mt-1 text-[0.98rem] leading-6 text-slate-400">
                  단어를 바꿔서 다시 찾아보세요.
                </p>
              </div>
            )}

            {filteredCategories.map((category) => {
              const isOpen = normalizedQuery ? true : openCategoryId === category.id;
              return (
                <section
                  key={category.id}
                  id={`help-category-${category.id}`}
                  className="rounded-2xl border border-slate-800 bg-slate-900/65"
                >
                  <button
                    onClick={() => {
                      if (normalizedQuery) return;
                      setOpenQuestionId('');
                      setOpenCategoryId(current => current === category.id ? '' : category.id);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
                    aria-expanded={isOpen}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/60 text-xl">
                        {category.icon}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[1.05rem] font-black text-slate-300">{category.title}</p>
                        <p className="mt-0.5 text-[0.96rem] font-bold text-slate-500">
                          질문 {category.questions.length}개
                        </p>
                      </div>
                    </div>
                    {isOpen ? <ChevronUp size={22} className="shrink-0 text-amber-300" /> : <ChevronDown size={22} className="shrink-0 text-slate-500" />}
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-800 px-3 py-3">
                      <div className="space-y-2">
                        {category.questions.map((question) => {
                          const isQuestionOpen = openQuestionId === `${category.id}:${question.id}` || normalizedQuery;
                          return (
                            <div
                              key={question.id}
                              className="rounded-2xl border border-slate-800 bg-slate-950/45"
                            >
                              <button
                                onClick={() => {
                                  if (normalizedQuery) {
                                    setOpenQuestionId(`${category.id}:${question.id}`);
                                    return;
                                  }
                                  setOpenQuestionId(current => current === `${category.id}:${question.id}` ? '' : `${category.id}:${question.id}`);
                                  setOpenCategoryId(category.id);
                                }}
                                className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
                                aria-expanded={isQuestionOpen}
                              >
                                <span className="min-w-0 flex-1 text-[1.02rem] font-black leading-6 text-white">
                                  {question.question}
                                </span>
                                {isQuestionOpen ? (
                                  <ChevronUp size={20} className="shrink-0 text-amber-300" />
                                ) : (
                                  <ChevronDown size={20} className="shrink-0 text-slate-500" />
                                )}
                              </button>

                              {isQuestionOpen && (
                                <div className="border-t border-slate-800 px-4 py-4">
                                  <div className="space-y-3">
                                    {question.answer.map((line, index) => (
                                      <div key={line} className="flex gap-3">
                                        <span className="mt-0.5 w-8 shrink-0 text-center text-[1.05rem] font-black text-amber-300">
                                          {String.fromCharCode(9312 + index)}
                                        </span>
                                        <p className="min-w-0 flex-1 text-[1rem] leading-7 text-slate-100">
                                          {line}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </main>

        <footer className="shrink-0 border-t border-slate-800 bg-slate-950/98 px-4 py-3">
          <p className="text-[0.92rem] font-medium leading-6 text-slate-500">
            앱관리자: 노경호
          </p>
          <p className="mt-1 text-[0.88rem] leading-6 text-slate-600">
            문제가 계속되면 이 안내를 확인하세요.
          </p>
        </footer>
      </div>
    </div>
  );
}
