import { expect, it } from 'vitest';
import { questionCount } from '../src/entities/course/model/rules';

it.each([
  [0, '0 вопросов'],
  [1, '1 вопрос'],
  [2, '2 вопроса'],
  [5, '5 вопросов'],
  [11, '11 вопросов'],
  [21, '21 вопрос'],
  [22, '22 вопроса'],
  [115, '115 вопросов'],
])('согласует количество вопросов: %s', (count, expected) => {
  expect(questionCount(count)).toBe(expected);
});
