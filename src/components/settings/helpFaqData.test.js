import { describe, expect, it } from 'vitest';
import { helpCategories, helpIntro, helpQuestionMatches, normalizeHelpQuery } from './helpFaqData';

describe('help faq data', () => {
  it('keeps the expected number of help categories and intro text', () => {
    expect(helpCategories).toHaveLength(6);
    expect(helpIntro.title).toBe('처음에는 무엇부터 하나요?');
  });

  it('uses the corrected edit instructions for amount and delete questions', () => {
    const editCategory = helpCategories.find(category => category.id === 'edit');
    const amountQuestion = editCategory.questions.find(question => question.id === 'amount-wrong');
    const deleteQuestion = editCategory.questions.find(question => question.id === 'delete-receipt');

    expect(amountQuestion.answer.join(' ')).toContain('연필 버튼');
    expect(amountQuestion.answer.join(' ')).not.toContain('길게 누르세요');
    expect(deleteQuestion.answer.join(' ')).toContain('휴지통 버튼');
    expect(deleteQuestion.answer.join(' ')).not.toContain('길게 누르세요');
  });

  it('matches help questions by answer text and keywords', () => {
    const uploadQuestion = helpCategories
      .find(category => category.id === 'drive')
      .questions.find(question => question.id === 'upload-how');

    expect(normalizeHelpQuery('  카톡  ')).toBe('카톡');
    expect(helpQuestionMatches('업로드', uploadQuestion)).toBe(true);
    expect(helpQuestionMatches('저장하기', uploadQuestion)).toBe(true);
    expect(helpQuestionMatches('없는단어', uploadQuestion)).toBe(false);
  });

  it('includes clear help for starting a new trip and choosing next-month end dates', () => {
    const settingsCategory = helpCategories.find(category => category.id === 'settings');
    const newTripQuestion = settingsCategory.questions.find(question => question.id === 'new-trip-start');
    const nextMonthQuestion = settingsCategory.questions.find(question => question.id === 'budget-next-month');

    expect(newTripQuestion.answer.join(' ')).toContain('실수로 누르지 않도록 접혀 있습니다');
    expect(newTripQuestion.answer.join(' ')).toContain('펼치기');
    expect(newTripQuestion.answer.join(' ')).toContain('확인 창');
    expect(nextMonthQuestion.answer.join(' ')).toContain('› 버튼');
    expect(nextMonthQuestion.answer.join(' ')).toContain('7월');
    expect(helpQuestionMatches('새출장', newTripQuestion)).toBe(true);
    expect(helpQuestionMatches('다음달', nextMonthQuestion)).toBe(true);
  });
});
