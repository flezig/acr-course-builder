import { expect, it } from 'vitest';
import { remarkCount } from '../src/pages/course-plan/page';

it.each([
  [0, '0 замечаний'],
  [1, '1 замечание'],
  [2, '2 замечания'],
  [5, '5 замечаний'],
  [11, '11 замечаний'],
  [21, '21 замечание'],
  [22, '22 замечания'],
  [115, '115 замечаний'],
])('согласует количество замечаний: %s', (count, expected) => {
  expect(remarkCount(count)).toBe(expected);
});
