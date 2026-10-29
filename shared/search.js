// Build once per query; reuse for any entity's searchable fields.
const TextSearch = Object.freeze({
  createMatcher(query) {
    const terms = [...new Set(String(query ?? '').toLowerCase().split(/\s+/u).filter(Boolean))];
    return fields => {
      const text = (Array.isArray(fields) ? fields : [fields])
        .map(value => String(value ?? '')).join('\n').toLowerCase();
      return terms.every(term => text.includes(term));
    };
  }
});

if (typeof module !== 'undefined' && module.exports) module.exports = TextSearch;
