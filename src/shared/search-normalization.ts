/** Normalize search input so Turkish terms with diacritics match ASCII aliases. */
export function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
}
