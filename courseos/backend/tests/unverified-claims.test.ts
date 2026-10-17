import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findUnverifiedClaims,
  markClaimsDeep,
  markUnverifiedClaims,
  UNVERIFIED_MARK,
} from '../src/steps/unverified-claims.ts';

test('находит выдуманные реквизиты нормативных документов и ссылки', () => {
  const text = [
    'Согласно приказу Минобрнауки от 01.07.2013 № 499 и закону 273-ФЗ.',
    'Требования ГОСТ Р 7.0.100-2018 и ГОСТ Р ИСО/МЭК 27001-2021.',
    'Профстандарт 06.001 «Программист».',
    'Документация: https://pandas.pydata.org/docs/, ISBN 978-5-4461-0712-9, doi 10.1000/xyz123.',
  ].join(' ');
  const kinds = findUnverifiedClaims(text, '').map((c) => c.kind);
  assert.deepEqual(kinds.sort(), [
    'DOI',
    'ISBN',
    'нормативный документ',
    'профстандарт',
    'ссылка',
    'стандарт',
    'стандарт',
    'федеральный закон',
  ]);
});

test('не трогает реквизиты из входных данных и числа без нормативного контекста', () => {
  const known = 'Профстандарт 06.001 «Программист», сайт https://pandas.pydata.org';
  const text = 'Опора на профстандарт 06.001. См. pandas.pydata.org и https://pandas.pydata.org. Задача № 3, версия 3.11, точность 0.95.';
  assert.deepEqual(findUnverifiedClaims(text, known), []);
});

test('помечает реквизит на месте и не дублирует пометку', () => {
  const once = markUnverifiedClaims('По приказу № 123 и приказу № 123.', '').text;
  assert.equal(once.split(UNVERIFIED_MARK).length - 1, 2);
  assert.equal(markUnverifiedClaims(once, '').text, once);
});

test('обходит вложенный ответ модели', () => {
  const claims: Array<{ kind: string }> = [];
  const result = markClaimsDeep(
    { slides: [{ bullets: ['Закон 152-ФЗ о персональных данных'] }], count: 3 },
    '',
    claims as never,
  );
  assert.match(result.slides[0].bullets[0], /152-ФЗ \[источник не подтверждён\]/);
  assert.equal(result.count, 3);
  assert.equal(claims.length, 1);
});
