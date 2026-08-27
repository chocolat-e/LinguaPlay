import type { Question } from '../game/types';

const STATIC_COMPONENTS: Record<number, string> = {
  1: 'common-adjective-synonyms',
  2: 'temperature-antonyms',
  3: 'present-simple-third-person',
  4: 'basic-word-classes-colours',
  5: 'morning-greetings',
  6: 'present-be-first-person',
  7: 'size-antonyms',
  8: 'everyday-places-shopping',
  9: 'academic-adjective-synonyms',
  10: 'present-perfect-since',
  11: 'first-conditional',
  12: 'intensity-vocabulary',
  13: 'personality-antonyms',
  14: 'past-simple-passive',
  15: 'doorway-social-language',
  16: 'ie-ei-spelling',
  17: 'adjective-preposition-collocations',
  18: 'formal-verb-synonyms',
  19: 'conversation-idioms',
  20: 'third-conditional-inversion',
  21: 'advanced-adjective-synonyms',
  22: 'quantity-antonyms',
  23: 'negative-adverbial-inversion',
  24: 'health-idioms',
  25: 'indefinite-pronoun-agreement',
  26: 'modality-and-inevitability-vocabulary',
  27: 'everyday-places-library',
  28: 'present-simple-first-person-plural',
  29: 'inverted-second-conditional',
  30: 'advanced-agreement-vocabulary',
};

export function knowledgeComponentFor(question: Question): string {
  return question.knowledgeComponent ?? STATIC_COMPONENTS[question.id] ?? `${question.category}-general`;
}

export function misconceptionFor(question: Question, selectedAnswer: number | null): string | null {
  if (selectedAnswer === null || selectedAnswer === question.correctAnswer) return null;
  const authored = question.misconceptions?.[selectedAnswer];
  if (authored && authored.toLocaleLowerCase() !== 'none') return authored;
  const selected = question.answers[selectedAnswer] ?? 'unknown answer';
  const correct = question.answers[question.correctAnswer] ?? 'unknown answer';
  return `Chose “${selected}” instead of “${correct}”`;
}
