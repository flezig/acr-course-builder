import catalog from './professional-standards/catalog.json';
import type { Requirements } from './schema';

export const professionalStandards = catalog;

export function professionalStandardReferences(scenario: string): Requirements['references'] {
  return professionalStandards
    .filter((standard) => standard.scenario === scenario)
    .map((standard) => ({
      id: standard.id,
      name: `Профстандарт ${standard.code} «${standard.title}»`,
      text: standard.text,
      url: standard.source_url,
      status: 'retrieved',
      coordinate: `Приказ №${standard.order_number} от ${standard.order_date}; редакция ${standard.edition_date}; разделы I–IV`,
      claim: standard.scope,
      checked_at: standard.retrieved_at,
      scope: 'Дата относится к получению текста; актуальность редакции и соответствие курса проверяет методист перед утверждением.',
      hash: standard.text_sha256,
      provenance: {
        origin: 'research',
        access: 'read',
        content: 'confirmed',
        extent: 'full_text',
        authors: 'Министерство труда и социальной защиты Российской Федерации',
        year: standard.order_date.slice(0, 4),
        title: standard.title,
        doi: '',
        study_type: 'Нормативный документ',
        population: '',
        result: standard.scope,
      },
    }));
}

export function attachedProfessionalStandards(requirements: Requirements) {
  return professionalStandards.filter((standard) =>
    requirements.references.some(
      (reference) => reference.id === standard.id && reference.text === standard.text,
    ),
  );
}

export function professionalStandardEvidence(requirements: Requirements): string {
  const attached = attachedProfessionalStandards(requirements);
  if (!attached.length && requirements.references.some(isProfessionalStandardReference))
    return `Текст профстандарта предоставлен методистом: ${requirements.references
      .filter(isProfessionalStandardReference)
      .map((reference) => reference.name)
      .join(
        '; ',
      )}. Название, код, полнота и актуальность редакции, а также связь результатов с трудовыми функциями требуют проверки.`;
  return attached.length
    ? `Приложен полный текст: ${attached.map((standard) => `${standard.code} «${standard.title}» (ред. ${standard.edition_date})`).join('; ')}. Актуальность редакции и связь результатов с трудовыми функциями требуют проверки методистом; коды результатов не заполнены.`
    : 'Не проверено: текст профстандарта не приложен, код оставлен пустым с пометкой.';
}

export function isProfessionalStandardReference(reference: Requirements['references'][number]) {
  return reference.id.startsWith('professional-standard-');
}
